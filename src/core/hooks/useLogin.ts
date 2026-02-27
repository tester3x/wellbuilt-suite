// src/core/hooks/useLogin.ts
// Shared login state machine hook — all 4 skins share this logic.
// Each skin's LoginScreen only handles rendering; this hook handles
// all state transitions, validation, Firebase calls, and navigation.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import {
  verifyLogin,
  saveDriverSession,
  isDriverVerified,
  submitRegistration,
  isPasscodeAvailable,
  getPendingRegistration,
  checkRegistrationStatus,
  completeRegistration,
  clearPendingRegistration,
} from '../services/driverAuth';

export type LoginMode =
  | 'checking'
  | 'login'
  | 'register'
  | 'verifying'
  | 'registering'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'error';

// Passcode validation: letters, numbers, and common symbols only
const VALID_PASSCODE_REGEX = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;

const validatePasscode = (code: string): { valid: boolean; error?: string } => {
  if (!code.trim()) {
    return { valid: false, error: 'Please create a passcode' };
  }
  if (code.length < 4) {
    return { valid: false, error: 'Passcode must be at least 4 characters' };
  }
  if (code.length > 12) {
    return { valid: false, error: 'Passcode must be 12 characters or less' };
  }
  if (!VALID_PASSCODE_REGEX.test(code)) {
    return { valid: false, error: 'Passcode contains invalid characters' };
  }
  return { valid: true };
};

export interface UseLoginReturn {
  mode: LoginMode;
  displayName: string;
  setDisplayName: (name: string) => void;
  passcode: string;
  setPasscode: (code: string) => void;
  companyName: string;
  setCompanyName: (name: string) => void;
  showPasscode: boolean;
  setShowPasscode: (show: boolean) => void;
  error: string;
  passcodeError: string;
  pendingName: string;
  /** Is the Sign In / Submit button enabled? */
  canSubmit: boolean;
  handleLogin: () => Promise<void>;
  handleRegister: () => Promise<void>;
  handleCompleteRegistration: () => Promise<void>;
  handleCancelRegistration: () => Promise<void>;
  handleTryAgain: () => void;
  handleSwitchToRegister: () => void;
  handleSwitchToLogin: () => void;
}

export function useLogin(): UseLoginReturn {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>('checking');
  const [passcode, setPasscode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcodeError, setPasscodeError] = useState('');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check initial state on mount
  useEffect(() => {
    checkInitialState();
  }, []);

  // Validate passcode as user types (only in register mode)
  useEffect(() => {
    if (mode === 'register' && passcode.length > 0) {
      const validation = validatePasscode(passcode);
      if (!validation.valid && validation.error?.includes('invalid characters')) {
        setPasscodeError(validation.error);
      } else {
        setPasscodeError('');
      }
    } else {
      setPasscodeError('');
    }
  }, [passcode, mode]);

  // Auto-poll for registration approval when in pending mode
  useEffect(() => {
    if (mode === 'pending') {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await checkRegistrationStatus();
          if (status === 'approved') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            const result = await completeRegistration();
            if (result.success) {
              router.replace('/home');
            } else {
              setMode('approved');
            }
          } else if (status === 'rejected') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setMode('rejected');
          }
        } catch (err) {
          console.log('[useLogin] Poll error (will retry):', err);
        }
      }, 5000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }
  }, [mode, router]);

  const checkInitialState = async () => {
    try {
      const verified = await isDriverVerified();
      if (verified) {
        router.replace('/home');
        return;
      }

      const pending = await getPendingRegistration();
      if (pending) {
        setPendingName(pending.displayName);
        const status = await checkRegistrationStatus();
        if (status === 'approved') {
          setMode('approved');
        } else if (status === 'rejected') {
          setMode('rejected');
        } else {
          setMode('pending');
        }
        return;
      }

      setMode('login');
    } catch (err) {
      console.error('[useLogin] Initial check error:', err);
      setMode('login');
    }
  };

  const handleLogin = useCallback(async () => {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!passcode.trim()) {
      setError('Please enter your passcode');
      return;
    }

    setMode('verifying');
    setError('');

    try {
      const result = await verifyLogin(displayName.trim(), passcode.trim());

      if (result.valid && result.driverId && result.displayName && result.passcodeHash) {
        await saveDriverSession(
          result.driverId,
          result.displayName,
          result.passcodeHash,
          result.isAdmin || false,
          result.isViewer || false,
          result.companyId,
          result.companyName,
        );
        router.replace('/home');
      } else {
        setMode('login');
        setError(result.error || 'Invalid name or passcode');
      }
    } catch (err) {
      console.error('[useLogin] Login error:', err);
      setMode('error');
      setError('Connection error. Please check your internet.');
    }
  }, [displayName, passcode, router]);

  const handleRegister = useCallback(async () => {
    const validation = validatePasscode(passcode);
    if (!validation.valid) {
      setError(validation.error || 'Invalid passcode');
      return;
    }

    if (!displayName.trim()) {
      setError('Please enter your display name');
      return;
    }

    if (displayName.trim().length < 2) {
      setError('Display name must be at least 2 characters');
      return;
    }

    setMode('registering');
    setError('');

    try {
      const available = await isPasscodeAvailable(passcode.trim());
      if (!available.available) {
        setMode('register');
        setError(available.reason || 'This passcode is not available');
        return;
      }

      const result = await submitRegistration({
        passcode: passcode.trim(),
        displayName: displayName.trim(),
        companyName: companyName.trim() || undefined,
      });

      if (result.success) {
        setPendingName(displayName.trim());
        setMode('pending');
      } else {
        setMode('register');
        setError(result.error || 'Could not submit registration');
      }
    } catch (err) {
      console.error('[useLogin] Registration error:', err);
      setMode('register');
      setError('Connection error. Please try again.');
    }
  }, [displayName, passcode]);

  const handleCompleteRegistration = useCallback(async () => {
    setMode('verifying');

    try {
      const result = await completeRegistration();
      if (result.success) {
        router.replace('/home');
      } else {
        setMode('error');
        setError(result.error || 'Could not complete registration');
      }
    } catch (err) {
      console.error('[useLogin] Complete registration error:', err);
      setMode('error');
      setError('Connection error. Please try again.');
    }
  }, [router]);

  const handleCancelRegistration = useCallback(async () => {
    await clearPendingRegistration();
    setPasscode('');
    setDisplayName('');
    setCompanyName('');
    setPendingName('');
    setMode('login');
  }, []);

  const handleTryAgain = useCallback(() => {
    setError('');
    setPasscode('');
    setMode('login');
  }, []);

  const handleSwitchToRegister = useCallback(() => {
    setError('');
    setPasscode('');
    setCompanyName('');
    setShowPasscode(false);
    setMode('register');
  }, []);

  const handleSwitchToLogin = useCallback(() => {
    setError('');
    setPasscode('');
    setCompanyName('');
    setShowPasscode(false);
    setMode('login');
  }, []);

  const canSubmit = mode === 'register'
    ? !!(passcode.trim() && displayName.trim() && companyName.trim() && !passcodeError)
    : !!(passcode.trim() && displayName.trim() && !passcodeError);

  return {
    mode,
    displayName,
    setDisplayName,
    passcode,
    setPasscode,
    companyName,
    setCompanyName,
    showPasscode,
    setShowPasscode,
    error,
    passcodeError,
    pendingName,
    canSubmit,
    handleLogin,
    handleRegister,
    handleCompleteRegistration,
    handleCancelRegistration,
    handleTryAgain,
    handleSwitchToRegister,
    handleSwitchToLogin,
  };
}
