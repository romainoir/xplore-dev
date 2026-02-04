
/**
 * RouteLibraryManager
 * Handles storage of routes using IndexedDB.
 */
export class RouteLibraryManager {
    constructor(dbName = 'XploreMapDB', storeName = 'routes') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbPromise = this.initDB();
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = (event) => {
                console.error('[RouteLibrary] IndexedDB error:', event.target.error);
                reject('IndexedDB connection failed');
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    store.createIndex('name', 'name', { unique: false });
                    console.log('[RouteLibrary] Object store created');
                }
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
        });
    }

    generateUUID() {
        return crypto.randomUUID();
    }

    /**
     * Save a route to the library.
     * @param {Object} routeData
     * @returns {Promise<string>} The route ID
     */
    async saveRoute(routeData) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const timestamp = Date.now();
            const id = routeData.id || this.generateUUID();

            const record = {
                ...routeData,
                id,
                updatedAt: timestamp,
                createdAt: routeData.createdAt || timestamp
            };

            const request = store.put(record);

            request.onsuccess = () => resolve(id);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Get all routes, sorted by updatedAt descending.
     * @returns {Promise<Array>} List of routes
     */
    async updateRoute(id, updates) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const request = store.get(id);

            request.onsuccess = () => {
                const data = request.result;
                if (!data) {
                    reject(new Error('Route not found'));
                    return;
                }

                const updatedData = {
                    ...data,
                    ...updates,
                    updatedAt: Date.now()
                };

                const updateRequest = store.put(updatedData);
                updateRequest.onsuccess = () => resolve(updatedData);
                updateRequest.onerror = (e) => reject(e.target.error);
            };

            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getAllRoutes() {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('updatedAt');
            const request = index.openCursor(null, 'prev'); // Descending order
            const routes = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    routes.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(routes);
                }
            };

            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Get a single route by ID.
     * @param {string} id
     * @returns {Promise<Object>}
     */
    async getRoute(id) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Delete a route by ID.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteRoute(id) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
}
