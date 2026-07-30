/**
 * Mounts branded eQuipment handoff modal and registers the confirm bridge
 * used by createSuiteDvirGate / dvirGateService.
 */
import React, { useEffect, useState } from 'react';
import type { DvirReceiptPhase } from '@/core/services/dvirGate/receiptTypes';
import {
  setEquipmentHandoffConfirmHandler,
  type EquipmentHandoffRequest,
} from '@/core/services/dvirGate/equipmentHandoffConfirm';
import DvirEquipmentHandoffModal from './DvirEquipmentHandoffModal';

type Pending = EquipmentHandoffRequest & {
  resolve: (ok: boolean) => void;
};

export default function DvirHandoffHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setEquipmentHandoffConfirmHandler((req) => {
      return new Promise<boolean>((resolve) => {
        setPending({ ...req, resolve });
      });
    });
    return () => {
      setEquipmentHandoffConfirmHandler(null);
    };
  }, []);

  const close = (ok: boolean) => {
    if (!pending) return;
    const { resolve } = pending;
    setPending(null);
    resolve(ok);
  };

  const phase: DvirReceiptPhase = pending?.phase ?? 'pre_trip';

  return (
    <DvirEquipmentHandoffModal
      visible={!!pending}
      phase={phase}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      onContinue={() => close(true)}
      onCancel={() => close(false)}
    />
  );
}
