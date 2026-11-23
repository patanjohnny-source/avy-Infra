import React from 'react';
import type { Employee, Project, Tower } from '../types/avy';
import { CustomQrStudioModal } from './CustomQrStudioModal';

interface WorkforceQrPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  projects: Project[];
  towers: Tower[];
  initialEmployeeId?: string;
  onPreviewQrProfile: (scanUrl: string) => void;
}

export function WorkforceQrPrintModal(props: WorkforceQrPrintModalProps) {
  return <CustomQrStudioModal {...props} defaultTarget="employees" />;
}
