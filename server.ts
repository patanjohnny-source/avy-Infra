import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

function formatGeminiApiError(err: unknown): { status: number; message: string } {
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown OCR error');
  if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('400')) {
    return {
      status: 400,
      message: 'Gemini API key rejected. Please check GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API permission denied. Please verify your API key in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      status: 429,
      message: 'Gemini API rate limit reached. Please wait a few seconds and try again.',
    };
  }
  return {
    status: 502,
    message: `Could not read screenshot with Gemini OCR: ${rawMessage}`,
  };
}

function isTransientDemandError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('TIMEOUT') ||
    msg.toLowerCase().includes('high demand')
  );
}

function withAttemptTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`OCR_ATTEMPT_TIMEOUT after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function generateOcrJsonWithFallback(
  ai: GoogleGenAI,
  params: {
    mimeType: string;
    base64Data: string;
    prompt: string;
    systemInstruction: string;
    responseSchema: Record<string, unknown>;
  },
) {
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
  let lastError: unknown;
  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    try {
      return await withAttemptTimeout(
        ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: params.mimeType,
                  data: params.base64Data,
                },
              },
              { text: params.prompt },
            ],
          },
          config: {
            systemInstruction: params.systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: params.responseSchema,
          },
        }),
        14000,
      );
    } catch (err) {
      lastError = err;
      if (!isTransientDemandError(err) || i === modelsToTry.length - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ocrConfigured: Boolean(getGeminiClient()) });
  });

  app.post('/api/ocr/advance-sheet', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable screenshot reading.',
      });
      return;
    }

    const { imageDataUrl, hintDate, employees } = req.body as {
      imageDataUrl?: string;
      hintDate?: string;
      employees?: Array<{ empCode?: string; fullName?: string; role?: string }>;
    };

    const parsed = parseDataUrl(imageDataUrl || '');
    if (!parsed) {
      res.status(400).json({ error: 'Please upload a valid PNG, JPEG, or WebP image screenshot.' });
      return;
    }

    const crewContext = Array.isArray(employees) && employees.length > 0
      ? employees
          .slice(0, 60)
          .map((e) => `${e.empCode || ''} - ${e.fullName || ''} (${e.role || ''})`)
          .join('\n')
      : 'None provided';

    const prompt = [
      'You are reading a handwritten or printed site register/note screenshot of worker advance payments for a construction tile-laying crew.',
      'IMPORTANT: Put ONLY the short document heading/title in `sheetTitle` (max 6 words). Put EVERY individual worker payment entry as a separate object inside the `rows` array.',
      'For each entry in `rows`:',
      '- rawName: worker name written on the line (keep best legible spelling).',
      '- rawEmpCode: employee ID / code if written (e.g. AVY-MSN-001, MSN-001, 001), else "".',
      '- amount: numeric INR amount (e.g. 500, 1200).',
      '- categoryText: category written (e.g. Daily Food, Weekly Food, Cash Advance, Gas Payment, Medical Advance, Travel Advance, Room Rent).',
      '- paymentModeText: Cash, UPI, GPay, PhonePe, Paytm, Bank Transfer if visible, else "".',
      `- date: ISO date YYYY-MM-DD if visible on row or sheet header (fallback hint: ${hintDate || ''}), else "".`,
      '- notes: any remark or tower/flat reference visible on that line.',
      '- confidence: "high", "medium", or "low".',
      'Known workforce directory for spelling/ID reference (only match if clearly similar):',
      crewContext,
    ].join('\n');

    try {
      const response = await generateOcrJsonWithFallback(ai, {
        mimeType: parsed.mimeType,
        base64Data: parsed.base64Data,
        prompt,
        systemInstruction:
          'You are a strict tabular OCR parser. Extract every worker advance line item into the `rows` array. Never put row items into `sheetTitle`.',
        responseSchema: {
          type: Type.OBJECT,
          required: ['sheetTitle', 'detectedDate', 'rows'],
          properties: {
            sheetTitle: {
              type: Type.STRING,
              description: 'Short heading/title of the sheet only (do NOT include line items here).',
            },
            detectedDate: {
              type: Type.STRING,
              description: 'Header date in YYYY-MM-DD format if visible, else empty string.',
            },
            rows: {
              type: Type.ARRAY,
              description: 'List of every worker advance line item visible in the image.',
              items: {
                type: Type.OBJECT,
                required: [
                  'rawName',
                  'rawEmpCode',
                  'amount',
                  'categoryText',
                  'paymentModeText',
                  'date',
                  'notes',
                  'confidence',
                ],
                properties: {
                  rawName: { type: Type.STRING, description: 'Worker full name on this line' },
                  rawEmpCode: { type: Type.STRING, description: 'Employee code/ID if written' },
                  amount: { type: Type.NUMBER, description: 'Advance INR amount as number' },
                  categoryText: { type: Type.STRING, description: 'Advance category text' },
                  paymentModeText: { type: Type.STRING, description: 'Cash, GPay, UPI, PhonePe, Paytm, or Bank' },
                  date: { type: Type.STRING, description: 'Date YYYY-MM-DD if shown' },
                  notes: { type: Type.STRING, description: 'Any remarks on this line' },
                  confidence: { type: Type.STRING, description: 'high, medium, or low' },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text || '{}').trim();
      const data = JSON.parse(rawText);
      res.json({
        sheetTitle: typeof data.sheetTitle === 'string' ? data.sheetTitle : '',
        detectedDate: typeof data.detectedDate === 'string' ? data.detectedDate : '',
        rows: Array.isArray(data.rows) ? data.rows : [],
      });
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/ocr/payment-receipt', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to auto-read UPI & Bank screenshots.',
      });
      return;
    }

    const { imageDataUrl } = req.body as { imageDataUrl?: string };
    const parsed = parseDataUrl(imageDataUrl || '');
    if (!parsed) {
      res.status(400).json({ error: 'Please upload a valid PNG, JPEG, or WebP payment screenshot.' });
      return;
    }

    const prompt = [
      'You are reading an Indian UPI or Bank Transfer payment confirmation screenshot (Google Pay / GPay, PhonePe, Paytm, BHIM, CRED, or Bank IMPS/NEFT/RTGS receipt).',
      'Extract exact visible details:',
      '- paymentApp: e.g. "GPay", "PhonePe", "Paytm", "Bank Transfer", or "UPI".',
      '- paymentMode: strictly "upi" or "bank_transfer". Use "bank_transfer" for NEFT/IMPS/RTGS/bank account transfer receipts, otherwise "upi".',
      '- transactionId: UPI Transaction ID, UTR Number, UPI Ref No., or Bank Reference No. (exact alphanumeric digits, no spaces unless printed).',
      '- upiId: recipient or sender UPI VPA ID (like name@okicici, 9876543210@ybl, name@paytm) or masked bank account reference (like A/C XX4321).',
      '- amount: numeric INR amount paid. 0 if unclear.',
      '- date: YYYY-MM-DD if a date is clearly visible, else empty string.',
      '- recipientName: payee / receiver name shown on screenshot.',
      '- senderInfo: sender bank name or account snippet if shown.',
      '- statusText: e.g. "Paid", "Completed", "Success", or status printed.',
      '- notes: short summary e.g. remarks/message attached to the payment.',
    ].join('\n');

    try {
      const response = await generateOcrJsonWithFallback(ai, {
        mimeType: parsed.mimeType,
        base64Data: parsed.base64Data,
        prompt,
        systemInstruction:
          'Extract payment receipt metadata faithfully as JSON. Never invent a Transaction ID or UPI ID that is not visible.',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            paymentApp: { type: Type.STRING },
            paymentMode: { type: Type.STRING },
            transactionId: { type: Type.STRING },
            upiId: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            date: { type: Type.STRING },
            recipientName: { type: Type.STRING },
            senderInfo: { type: Type.STRING },
            statusText: { type: Type.STRING },
            notes: { type: Type.STRING },
          },
        },
      });

      const rawText = (response.text || '{}').trim();
      const data = JSON.parse(rawText);
      res.json({
        paymentApp: typeof data.paymentApp === 'string' ? data.paymentApp : 'UPI',
        paymentMode: data.paymentMode === 'bank_transfer' ? 'bank_transfer' : 'upi',
        transactionId: typeof data.transactionId === 'string' ? data.transactionId : '',
        upiId: typeof data.upiId === 'string' ? data.upiId : '',
        amount: typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : 0,
        date: typeof data.date === 'string' ? data.date : '',
        recipientName: typeof data.recipientName === 'string' ? data.recipientName : '',
        senderInfo: typeof data.senderInfo === 'string' ? data.senderInfo : '',
        statusText: typeof data.statusText === 'string' ? data.statusText : '',
        notes: typeof data.notes === 'string' ? data.notes : '',
      });
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/billing/draft-items', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to use Gemini AI Billing Drafter.',
      });
      return;
    }

    const { scopePrompt, docType, projectName, towerName, completedSqftSummary } = req.body as {
      scopePrompt?: string;
      docType?: string;
      projectName?: string;
      towerName?: string;
      completedSqftSummary?: string;
    };

    const userText = (scopePrompt || '').trim();
    if (!userText) {
      res.status(400).json({ error: 'Please describe the tiling work scope, flat numbers, or sq.ft measurements.' });
      return;
    }

    const engineeredPrompt = [
      'You are an expert Quantity Surveyor (QS) and GST Billing Engineer for an Indian Tile Laying, Marble, Granite & Stone Finishing Contracting Firm.',
      `Document Type: ${docType || 'tax_invoice'}`,
      projectName ? `Project: ${projectName}` : '',
      towerName ? `Tower/Block: ${towerName}` : '',
      completedSqftSummary ? `Site Area Reference: ${completedSqftSummary}` : '',
      `User Request / Work Scope:\n"""\n${userText}\n"""`,
      'Task: Convert this scope into clean, itemized construction BOQ billing rows.',
      'Rules:',
      '- Use Indian GST HSN/SAC code 995433 for tile/stone laying & finishing services unless material supply (e.g. 6907 tiles / 3824 adhesive) is specified.',
      '- Typical unit values: "Sq.Ft", "R.Ft", "Nos", "Lump Sum", "Floor".',
      '- Typical gstRate: 18 (unless user specifies another rate like 12 or 5 or 0).',
      '- Write concise, client-ready descriptions suitable for a formal Tax Invoice or Quotation.',
      '- Include professional contractor payment terms or measurement notes in `suggestedNotes`.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let responseText = '{}';
      let lastError: unknown;

      for (let i = 0; i < modelsToTry.length; i += 1) {
        try {
          const result = await withAttemptTimeout(
            ai.models.generateContent({
              model: modelsToTry[i],
              contents: engineeredPrompt,
              config: {
                systemInstruction:
                  'Return strict JSON with itemized construction billing lines, realistic quantities/rates when explicitly mentioned or clearly implied, and accurate HSN/SAC 995433.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  required: ['suggestedNotes', 'items'],
                  properties: {
                    suggestedNotes: {
                      type: Type.STRING,
                      description: 'Short billing remark / measurement basis summary.',
                    },
                    items: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        required: ['description', 'hsnSac', 'unit', 'quantity', 'rate', 'gstRate'],
                        properties: {
                          description: { type: Type.STRING },
                          hsnSac: { type: Type.STRING },
                          unit: { type: Type.STRING },
                          quantity: { type: Type.NUMBER },
                          rate: { type: Type.NUMBER },
                          gstRate: { type: Type.NUMBER },
                        },
                      },
                    },
                  },
                },
              },
            }),
            14000
          );
          responseText = (result.text || '{}').trim();
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (!isTransientDemandError(err) || i === modelsToTry.length - 1) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      if (lastError) throw lastError;
      const parsed = JSON.parse(responseText) as {
        suggestedNotes?: string;
        items?: Array<{
          description?: string;
          hsnSac?: string;
          unit?: string;
          quantity?: number;
          rate?: number;
          gstRate?: number;
        }>;
      };

      res.json({
        suggestedNotes: typeof parsed.suggestedNotes === 'string' ? parsed.suggestedNotes : '',
        items: Array.isArray(parsed.items)
          ? parsed.items.slice(0, 25).map((item) => ({
              description: String(item.description || 'Tile Laying Work').slice(0, 160),
              hsnSac: String(item.hsnSac || '995433').slice(0, 16),
              unit: String(item.unit || 'Sq.Ft').slice(0, 24),
              quantity: Math.max(0, Number(item.quantity) || 0),
              rate: Math.max(0, Number(item.rate) || 0),
              gstRate: Math.max(0, Math.min(28, Number(item.gstRate ?? 18))),
            }))
          : [],
      });
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AVY INFRA server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AVY INFRA server:', err);
  process.exit(1);
});
