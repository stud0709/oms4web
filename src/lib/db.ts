import { OmsDbSchema } from "@/types/types";
import { openDB } from "idb";

export const DB_VERSION = 7;
export const STORAGE_KEY = 'current';
export const DB_NAME = 'oms4web';
export const KEY_REQUEST_STORE = 'key_request_store';
/**OBSOLETE, migrated to VAUOT_STORE_V2*/
export const VAULT_STORE = 'vault_data';
export const VAULT_STORE_V2 = 'vault_store';
export const QUICK_UNLOCK_STORE = 'quick_unlock_store';

export const oms4webDbPromise = openDB<OmsDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
        console.warn("Database upgrade detected");
/*
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
            db.createObjectStore(VAULT_STORE);
        }
*/
        if (!db.objectStoreNames.contains(VAULT_STORE_V2)) {
            db.createObjectStore(VAULT_STORE_V2);
        }

        if (!db.objectStoreNames.contains(KEY_REQUEST_STORE)) {
            db.createObjectStore(KEY_REQUEST_STORE);
        }
        if(!db.objectStoreNames.contains(QUICK_UNLOCK_STORE)){
            db.createObjectStore(QUICK_UNLOCK_STORE);
        }

        //TODO: remove old storage at some point
        //db.deleteObjectStore(VAULT_STORE_OBSOLETE);
    },
    blocked() {
        console.warn("Database upgrade blocked! Please close other tabs.");
    },
    blocking() {
        console.warn("This tab is blocking an upgrade in another tab.");
    }
});