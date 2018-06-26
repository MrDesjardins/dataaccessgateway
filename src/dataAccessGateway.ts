
import axios, { AxiosPromise, AxiosResponse } from "axios";
import Dexie from "dexie";
import { AjaxRequest, CacheDataWithId, CachedData, DataAction, DataResponse, DataSource, LogError, LogInfo, OnGoingAjaxRequest } from "./model";
export class DataAccessIndexDbDatabase extends Dexie {
    public data!: Dexie.Table<CacheDataWithId<any>, string>; // Will be initialized later

    public constructor(databaseName: string) {
        super(databaseName);
    }

    public dropTable(): Promise<void> {
        if (this.data !== undefined) {
            return this.data.clear();
        }
        return Promise.reject("Table cannot be drop because it is not defined");
    }
}
export interface DataAccessSingletonOptions {
    isCacheEnabled: boolean;
    isCacheMandatoryIfEnabled: boolean;
    defaultLifeSpanInSeconds: number;
    logError: (error: LogError) => void;
    logInfo: (info: LogInfo) => void;
}

/**
 * The role of this interface is to limit what is public. This allow to have almost every
 * functions public in the concrete class which ease the unitestability of the code and
 * preserve a define set of available feature through the singleton with the interface.
 */
export interface IDataAccessSingleton {
    setConfiguration(options?: Partial<DataAccessSingletonOptions>): void;
    fetchFresh<T>(request: AjaxRequest): Promise<DataResponse<T>>;
    fetchFast<T>(request: AjaxRequest): Promise<DataResponse<T>>
    deleteDataFromCache(id: string): void;
}

export interface DeleteCacheOptions {
    memory?: boolean;
    persistent?: boolean;
}

/**
 * The Data Access is a singleton because we want to keep all the application data into
 * a single source avoiding duplication of cache.
 */
export class DataAccessSingleton implements IDataAccessSingleton {
    private static instance: DataAccessSingleton | undefined = undefined;
    public DefaultOptions: Readonly<DataAccessSingletonOptions> = {
        isCacheEnabled: true,
        isCacheMandatoryIfEnabled: true,
        defaultLifeSpanInSeconds: 5 * 60,
        logError: () => { /*Nothing*/ },
        logInfo: () => { /*Nothing*/ },
    };
    public options: DataAccessSingletonOptions = this.DefaultOptions;
    private onGoingRequest: Map<string, OnGoingAjaxRequest> = new Map<string, OnGoingAjaxRequest>();
    private cachedResponse: Map<string, string> = new Map<string, string>();
    public openIndexDb: DataAccessIndexDbDatabase;
    public constructor(databaseName: string) {
        this.openIndexDb = new DataAccessIndexDbDatabase(databaseName);
    }

    public static getInstance(databaseName: string): IDataAccessSingleton {
        if (DataAccessSingleton.instance === undefined) {
            DataAccessSingleton.instance = new DataAccessSingleton(databaseName);
        }

        return DataAccessSingleton.instance;
    }

    public setConfiguration(options?: Partial<DataAccessSingletonOptions>): void {
        if (options !== undefined) {
            this.options = { ...this.DefaultOptions, ...options };
        }
    }

    /**
     * Go in the memory cache first, then the persisted cache. In all level of cache, if the data is outdated it will fetch and
     * wait the response to cache it and return it. It means that each time the data is obsolete that the fetch takes time but
     * subsequent request will be faster. This function focus on accuracy first.
     */
    public fetchFresh<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        this.setDefaultRequestId(request); // Default values        
        this.setDefaultCache(request); // We enforce a minimum memory cache of few seconds

        return this.tryMemoryCacheFetching<T>(request).then((memoryCacheValue: DataResponse<T> | undefined) => {
            if (memoryCacheValue === undefined) {
                this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.MemoryCache });
                return this.tryPersistentStorageFetching<T>(request);
            } else {
                this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.MemoryCache });
                return memoryCacheValue;
            }
        }).then((cacheResult: DataResponse<T> | undefined) => {
            if (cacheResult === undefined) {
                return this.fetchWithAjax<T>(request).then((value: AxiosResponse<T>) => {
                    this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.HttpRequest });
                    return Promise.resolve({
                        source: DataSource.HttpRequest,
                        result: value.data
                    });
                });
            }
            return Promise.resolve(cacheResult);
        }).then((responseFromCacheOrAjax: DataResponse<T>) => {
            return this.saveCache(request, responseFromCacheOrAjax);
        });
    }

    /**
     * Fetch fast always returns the data from the cache if available. It returns data that can be obsolete, older than the lifetime
     * specified in the configuration. The lifespan specified is only to indicate when the data must be refreshed which mean that
     * an obsolete value is returned but the system will do the Ajax call to get it for the NEXT invocation. It is important to
     * understand that the fetch fast principle is that it's better to return a stale value than nothing BUT will respect the lifespan
     * to fetch the new value. Fetch fast works better if most of the data (if not all) is stored with a persistence
     */
    public fetchFast<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        // If the flag is off, we skip and go directly to the Ajax
        if (!this.options.isCacheEnabled) {
            this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.HttpRequest });
            return this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.HttpRequest);
        }

        this.setDefaultRequestId(request); // Default values        
        this.setDefaultFastCache(request); // We enforce a minimum memory cache of few seconds

        // Check memory cache first
        const memoryCacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(request.id!);
        if (memoryCacheEntry === undefined) {
            // Not in memory, check in long term storage
            return this.getPersistentStoreData(request.id!).then((persistentStorageValue: CachedData<{}> | undefined) => {
                if (persistentStorageValue === undefined) {
                    this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.HttpRequest });
                    return this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.HttpRequest); // Not in the persistent storage means we must fetch from API
                } else {
                    // We have something from the persistent cache
                    const persistentStorageEntry = persistentStorageValue as CachedData<T>;
                    if (request.memoryCache !== undefined) {
                        this.addInMemoryCache(request.id!, request.memoryCache.lifespanInSeconds!, persistentStorageEntry.payload);
                    }
                    this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.PersistentStorageCache, persistentStorageEntry); // It's expired which mean we fetch to get fresh data HOWEVER, we will return the obsolete data to have a fast response
                    // Return the persistent storage even if expired
                    this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.PersistentStorageCache });
                    return Promise.resolve({
                        source: DataSource.PersistentStorageCache,
                        result: persistentStorageEntry.payload
                    });
                }
            });
        } else {
            this.options.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.MemoryCache });
            this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.MemoryCache, memoryCacheEntry); // We have something in the memory, but we might still want to fetch if expire for future requests
            return Promise.resolve({
                source: DataSource.MemoryCache,
                result: memoryCacheEntry.payload
            });
        }
    }

    public fetchAndSaveInCacheIfExpired<T>(request: AjaxRequest, source: DataSource, cacheEntry?: CachedData<T> | undefined): Promise<DataResponse<T>> {
        if (cacheEntry === undefined || (new Date()).getTime() > new Date(cacheEntry.expirationDateTime).getTime()) {
            return this.fetchWithAjax<T>(request).then((value: AxiosResponse<T>) => {
                if (value.status >= 200 && value.status <= 399) {
                    return this.saveCache(request, {
                        source: DataSource.HttpRequest,
                        result: value.data
                    });
                } else {
                    return Promise.reject("Cannot cache request that are not in the range of 200 or in the range of 300.");
                }
            });
        } else {
            return Promise.resolve({
                source: source, // This might be from the persistent storage as well
                result: cacheEntry.payload
            });
        }
    }

    public setDefaultRequestId(request: AjaxRequest): void {
        if (request.id === undefined) {
            if (request.request.url === undefined) {
                request.id = "";
            } else {
                request.id = request.request.url;
            }
        }
    }

    public setDefaultCache(request: AjaxRequest): void {
        if (request.memoryCache === undefined && this.options.isCacheMandatoryIfEnabled) {
            request.memoryCache = { lifespanInSeconds: this.options.defaultLifeSpanInSeconds }; // Provide ALWAYS a minimum memory cache with small life
        }
    }
    public setDefaultFastCache(request: AjaxRequest): void {
        this.setDefaultCache(request);
        if (request.persistentCache === undefined && this.options.isCacheMandatoryIfEnabled) {
            request.persistentCache = { lifespanInSeconds: this.options.defaultLifeSpanInSeconds }; // Provide ALWAYS a minimum memory cache with small life
        }
    }

    public saveCache<T>(request: AjaxRequest, responseFromCacheOrAjax: DataResponse<T>): Promise<DataResponse<T>> {
        // At the end, we check if we need to store in any of the cache
        if (request.memoryCache !== undefined) {
            this.addInMemoryCache(request.id!, request.memoryCache.lifespanInSeconds!, responseFromCacheOrAjax.result);
        }
        if (request.persistentCache !== undefined) {
            const currentUTCDataWithLifeSpanAdded = new Date((new Date()).getTime() + request.persistentCache.lifespanInSeconds * 1000);
            const cachedData: CachedData<T> = {
                expirationDateTime: currentUTCDataWithLifeSpanAdded,
                payload: responseFromCacheOrAjax.result
            };
            this.addInPersistentStore(request.id!, cachedData);
        }
        return Promise.resolve(responseFromCacheOrAjax);
    }

    public tryMemoryCacheFetching<T>(request: AjaxRequest): Promise<DataResponse<T> | undefined> {
        if (this.options.isCacheEnabled === false || request.memoryCache === undefined) {
            return Promise.resolve(undefined);
        }
        const cacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(request.id!);
        if (cacheEntry !== undefined) {
            // If expired, fetch
            if ((new Date()).getTime() > (new Date(cacheEntry.expirationDateTime)).getTime()) {
                // Delete from cache
                this.deleteFromMemoryCache(request.id!);
            } else {
                // Return the cached response
                return Promise.resolve({
                    source: DataSource.MemoryCache,
                    result: cacheEntry.payload
                });
            }
        }
        return Promise.resolve(undefined);
    }

    public tryPersistentStorageFetching<T>(request: AjaxRequest): Promise<DataResponse<T> | undefined> {
        if (this.options.isCacheEnabled === false || request.persistentCache === undefined) {
            return Promise.resolve(undefined);
        }
        return this.getPersistentStoreData(request.id!)
            .then((persistentStorageValue: CachedData<{}> | undefined) => {
                if (persistentStorageValue !== undefined) {
                    const localStorageCacheEntry = persistentStorageValue as CachedData<T>;
                    if (new Date().getTime() > (new Date(localStorageCacheEntry.expirationDateTime)).getTime()) {
                        this.deleteFromPersistentStorage(request.id!);
                    } else {
                        return Promise.resolve({
                            source: DataSource.PersistentStorageCache,
                            result: localStorageCacheEntry.payload
                        });
                    }
                }
                return Promise.resolve(undefined);
            });
    }

    public fetchWithAjax<T>(request: AjaxRequest): AxiosPromise<T> {
        // Check if already on-going request
        const cacheOnGoingEntry: OnGoingAjaxRequest | undefined = this.onGoingRequest.get(request.id!);
        if (cacheOnGoingEntry === undefined) {
            // Execute Ajax call
            // Add listener to remove from onGoing once we receive a success or failure from the request
            const promiseAjaxResponse = axios(request.request)
                .then((response: AxiosResponse<T>) => {
                    this.deleteOnGoingRequest(request.id!);
                    return response;
                }).catch((reason) => {
                    this.options.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Fetch });
                    throw reason;
                });
            // Add into the on-going queue
            this.onGoingRequest.set(request.id!, {
                ajaxRequest: request,
                promise: promiseAjaxResponse
            });
            return promiseAjaxResponse;
        } else {
            // Already on-going fetching, return the response promise from previous request.
            return cacheOnGoingEntry.promise;
        }
    }

    public deleteFromMemoryCache(id: string): void {
        this.options.logInfo({ id: id, source: DataSource.MemoryCache, action: DataAction.Delete });
        this.cachedResponse.delete(id);
    }

    public deleteOnGoingRequest(id: string): void {
        this.onGoingRequest.delete(id);
    }

    public addInMemoryCache<T>(id: string, lifespanInSeconds: number, dataToAdd: T): void {
        const currentUTCDataWithLifeSpanAdded = new Date((new Date()).getTime() + lifespanInSeconds * 1000);
        this.options.logInfo({ id: id, source: DataSource.MemoryCache, action: DataAction.Save });
        this.cachedResponse.set(id, JSON.stringify({
            expirationDateTime: currentUTCDataWithLifeSpanAdded,
            payload: dataToAdd
        }));
    }

    public async addInPersistentStore<T>(id: string, cacheData: CachedData<T>): Promise<string> {
        this.options.logInfo({ id: id, source: DataSource.PersistentStorageCache, action: DataAction.Save });
        try {
            return this.openIndexDb.transaction("rw", this.openIndexDb.data, async () => {
                return this.openIndexDb.data.put({ id: id, ...cacheData });
            });
        } catch (reason) {
            this.options.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Save });
            throw reason;
        }
    }
    public getMemoryStoreData<T>(id: string): CachedData<T> | undefined {
        const cacheValue = this.cachedResponse.get(id);
        if (cacheValue === undefined) {
            return undefined;
        }
        return JSON.parse(cacheValue) as CachedData<T>;
    }
    public async getPersistentStoreData<T>(id: string): Promise<CacheDataWithId<T> | undefined> {
        try {
            return this.openIndexDb.data.get(id);
        }
        catch (reason) {
            this.options.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Fetch });
            throw reason;
        }
    }

    public async deleteFromPersistentStorage(id: string): Promise<void> {
        try {
            return this.openIndexDb.data.delete(id);
        } catch (reason) {
            this.options.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Delete });
            throw reason;
        }
    }

    public deleteDataFromCache(id: string, options?: DeleteCacheOptions): void {
        if (options === undefined) {
            this.deleteFromMemoryCache(id);
            this.deleteFromPersistentStorage(id);
        } else {
            if (options.memory !== undefined && options.memory === true) {
                this.deleteFromMemoryCache(id);
            }
            if (options.persistent !== undefined && options.persistent === true) {
                this.deleteFromPersistentStorage(id);
            }
        }
    }
}
const DataAccessGateway: (databaseName: string) => IDataAccessSingleton
    = (databaseName: string = "DatabaseName") => DataAccessSingleton.getInstance(databaseName);
export default DataAccessGateway;
