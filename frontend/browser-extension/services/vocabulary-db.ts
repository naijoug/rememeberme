export class VocabularyDB {
  private connection?: Promise<IDBDatabase>;
  constructor(private name = 'rememberme-vocabulary-v2') {}
  private open(): Promise<IDBDatabase> {
    return this.connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('partitions');
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.connection = undefined; };
        resolve(request.result);
      };
      request.onerror = () => { this.connection = undefined; reject(request.error); };
      request.onblocked = () => reject(new Error('Close older extension pages to complete the vocabulary upgrade.'));
    });
  }
  async read<T>(key: string): Promise<T | undefined> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('partitions', 'readonly');
      const request = transaction.objectStore('partitions').get(key);
      transaction.oncomplete = () => resolve(request.result as T | undefined);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  }
  async write<T>(key: string, value: T): Promise<void> {
    return this.writeMany([[key, value]]);
  }
  async writeMany(values: [string, unknown][]): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('partitions', 'readwrite', { durability: 'strict' });
      for (const [key, value] of values) transaction.objectStore('partitions').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Vocabulary transaction aborted.'));
    });
  }
  async initialize<T>(key: string, value: T): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('partitions', 'readwrite', { durability: 'strict' });
      const store = transaction.objectStore('partitions'); const request = store.get(key);
      let result = value;
      request.onsuccess = () => { if (request.result !== undefined) result = request.result; else store.put(value, key); };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  }
}
