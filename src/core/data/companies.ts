// companies.ts — DEPRECATED
// Company selection has been removed. Auth is now driver-based via Firebase RTDB.
// This file is kept to avoid import errors in any lingering references.
// All real auth data lives in Firebase RTDB under drivers/approved/{passcodeHash}.

export interface Company {
  id: string;
  name: string;
}

export const companies: Company[] = [];
