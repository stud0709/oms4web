import { OmsDbSchema } from "@/types/types";
import { openDB } from "idb";

export const DB_VERSION = 5;
export const STORAGE_KEY = 'current';
export const DB_NAME = 'oms4web';
export const KEY_REQUEST_STORE = 'key_request_store';
export const VAULT_STORE = 'vault_data';

export const oms4webDbPromise = openDB<OmsDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
        console.warn("Database upgrade detected");

        if (!db.objectStoreNames.contains(VAULT_STORE)) {
            db.createObjectStore(VAULT_STORE);
        }

        if (!db.objectStoreNames.contains(KEY_REQUEST_STORE)) {
            db.createObjectStore(KEY_REQUEST_STORE);
        }
    },
    blocked() {
        console.warn("Database upgrade blocked! Please close other tabs.");
    },
    blocking() {
        console.warn("This tab is blocking an upgrade in another tab.");
    }
});