/**
 * The ONE production return-state store for the app.
 *
 * A module singleton on purpose: the ownership guarantee in returnStateStore.ts
 * comes from every writer sharing a single FIFO queue. Two stores over the same
 * SecureStore keys would serialize against themselves and race each other, so
 * nothing may construct a second one for production use — import this.
 */
import * as SecureStore from 'expo-secure-store';
import { createReturnStateStore, type ReturnStateKv, type ReturnStateStore } from './returnStateStore';

const secureStoreKv: ReturnStateKv = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export const returnStateStore: ReturnStateStore = createReturnStateStore(secureStoreKv);
