
import axios, { AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import Dexie from "dexie";
import { AjaxRequest, CacheDataWithId, CachedData, DataAction, DataResponse, DataSource, LogError, LogInfo, OnGoingAjaxRequest, PerformanceRequestInsight } from "./model";
export class DataAccessIndexDbDatabase extends Dexie {
    public data!: Dexie.Table<CacheDataWithId<any>, string>; // Will be initialized later

    public constructor(databaseName: string) {
        super(databaseName);
        this.version(1).stores({
            data: "id"
        });
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
    fetchWeb<T>(request: AjaxRequest): Promise<DataResponse<T>>;
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
        logInfo: () => { /*Nothing*/ }
    };
    public options: DataAccessSingletonOptions = this.DefaultOptions;
    public onGoingAjaxRequest: Map<string, OnGoingAjaxRequest> = new Map<string, OnGoingAjaxRequest>();
    public performanceInsights: Map<string, PerformanceRequestInsight> = new Map<string, PerformanceRequestInsight>();
    public cachedResponse: Map<string, string> = new Map<string, string>();
    public openIndexDb?: DataAccessIndexDbDatabase;
    public constructor(databaseName: string) {
        try {
            this.openIndexDb = new DataAccessIndexDbDatabase(databaseName);
        } catch (e) {
            this.logError({ action: DataAction.System, source: DataSource.System, error: e });
        }
    }

    public static getInstance(databaseName: string): IDataAccessSingleton {
        if (DataAccessSingleton.instance === undefined) {
            DataAccessSingleton.instance = new DataAccessSingleton(databaseName);
        }

        return DataAccessSingleton.instance;
    }

    public logInfo(info: Pick<LogInfo, Exclude<keyof LogInfo, "kind">>): void {
        const requestInfo: LogInfo = { ...info, kind: "LogInfo" };
        this.options.logInfo(requestInfo);
        if (window) {
            window.postMessage({
                source: "dataaccessgateway-agent",
                payload: requestInfo
            }, "*");
        }
    }
    public logError(error: Pick<LogError, Exclude<keyof LogError, "kind">>): void {
        const requestError: LogError = { ...error, kind: "LogError" };
        this.options.logError({ ...error, kind: "LogError" });
        if (window) {
            window.postMessage({
                source: "dataaccessgateway-agent",
                payload: requestError
            }, "*");
        }
    }

    public setConfiguration(options?: Partial<DataAccessSingletonOptions>): void {
        if (options !== undefined) {
            this.options = { ...this.DefaultOptions, ...options };
        }
    }

    public fetchWeb<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        this.setDefaultRequestId(request); // Default values        
        this.startPerformanceInsight(request.id!);
        return this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.HttpRequest)
            .then((response: DataResponse<T>) => {
                this.stopPerformanceInsight(this.getPerformanceInsight(request.id!));
                this.logInfo(
                    {
                        action: DataAction.Use,
                        id: request.id!,
                        source: DataSource.HttpRequest,
                        performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), response.result)
                    });
                this.deletePerformanceInsight(request.id!);
                return response;
            }).catch((reason: any) => {
                this.deletePerformanceInsight(request.id!);
                throw reason;
            });
    }
    /**
     * Go in the memory cache first, then the persisted cache. In all level of cache, if the data is outdated it will fetch and
     * wait the response to cache it and return it. It means that each time the data is obsolete that the fetch takes time but
     * subsequent request will be faster. This function focus on accuracy first.
     */
    public fetchFresh<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        this.setDefaultRequestId(request); // Default values        
        this.setDefaultCache(request); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(request.id!);
        return this.tryMemoryCacheFetching<T>(request)
            .then((memoryCacheValue: DataResponse<T> | undefined) => {
                if (memoryCacheValue === undefined) {
                    return this.tryPersistentStorageFetching<T>(request)
                        .then((persistentCacheValue: DataResponse<T> | undefined) => {
                            if (persistentCacheValue !== undefined) {
                                this.logInfo(
                                    {
                                        action: DataAction.Use,
                                        id: request.id!,
                                        source: DataSource.PersistentStorageCache,
                                        performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), persistentCacheValue.result)
                                    });
                            }
                            return persistentCacheValue;
                        }).catch((reason: any) => {
                            this.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Fetch });
                            return undefined;
                        });
                } else {
                    this.stopPerformanceInsight(request.id!);
                    this.logInfo(
                        {
                            action: DataAction.Use,
                            id: request.id!,
                            source: DataSource.MemoryCache,
                            performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), memoryCacheValue)
                        });
                    this.deletePerformanceInsight(request.id!);
                    return memoryCacheValue;
                }
            }).then((memoryOrPersistentCacheValue: DataResponse<T> | undefined) => {
                if (memoryOrPersistentCacheValue === undefined) {
                    this.startPerformanceInsight(request.id!, DataSource.HttpRequest);
                    return this.fetchWithAjax<T>(request).then((value: AxiosResponse<T>) => {
                        this.stopPerformanceInsight(request.id!, DataSource.HttpRequest);
                        this.logInfo(
                            {
                                action: DataAction.Use,
                                id: request.id!,
                                source: DataSource.HttpRequest,
                                performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), value.data)
                            });
                        this.deletePerformanceInsight(request.id!);
                        return Promise.resolve({
                            source: DataSource.HttpRequest,
                            result: value.data
                        });
                    });
                }
                return Promise.resolve(memoryOrPersistentCacheValue);
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
        this.setDefaultRequestId(request); // Default values        
        this.setDefaultFastCache(request); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(request.id!);

        // If the flag is off, we skip and go directly to the Ajax
        if (!this.options.isCacheEnabled) {
            return this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.HttpRequest)
                .then((response: DataResponse<T>) => {
                    this.stopPerformanceInsight(request.id!, DataSource.HttpRequest);
                    this.logInfo(
                        {
                            action: DataAction.Use,
                            id: request.id!,
                            source: DataSource.HttpRequest,
                            performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), response.result)
                        });
                    return response;
                });
        }

        // Check memory cache first
        const memoryCacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(request.id!);
        if (memoryCacheEntry === undefined) {
            // Not in memory, check in long term storage
            return this.getPersistentStoreData(request.id!).then((persistentStorageValue: CachedData<{}> | undefined) => {
                if (persistentStorageValue === undefined) {
                    // Not in the persistent storage means we must fetch from API
                    return this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.HttpRequest)
                        .then((response: DataResponse<T>) => {
                            this.stopPerformanceInsight(request.id!);
                            this.logInfo(
                                {
                                    action: DataAction.Use,
                                    id: request.id!,
                                    source: DataSource.HttpRequest,
                                    performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), response.result)
                                });
                            return response;
                        });
                } else {
                    // We have something from the persistent cache
                    const persistentStorageEntry = persistentStorageValue as CachedData<T>;
                    if (request.memoryCache !== undefined) {
                        this.addInMemoryCache(request.id!, request.memoryCache.lifespanInSeconds!, persistentStorageEntry.payload);
                    }
                    this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.PersistentStorageCache, persistentStorageEntry); // It's expired which mean we fetch to get fresh data HOWEVER, we will return the obsolete data to have a fast response
                    // Return the persistent storage even if expired
                    this.stopPerformanceInsight(request.id!);
                    this.logInfo(
                        {
                            action: DataAction.Use,
                            id: request.id!,
                            source: DataSource.PersistentStorageCache,
                            performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), persistentStorageEntry.payload)
                        });
                    return Promise.resolve({
                        source: DataSource.PersistentStorageCache,
                        result: persistentStorageEntry.payload
                    });
                }
            });
        } else {
            this.fetchAndSaveInCacheIfExpired<T>(request, DataSource.MemoryCache, memoryCacheEntry); // We have something in the memory, but we might still want to fetch if expire for future requests
            this.stopPerformanceInsight(request.id!, DataSource.MemoryCache);
            this.stopPerformanceInsight(request.id!);
            this.logInfo(
                {
                    action: DataAction.Use,
                    id: request.id!,
                    source: DataSource.MemoryCache,
                    performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), memoryCacheEntry.payload)
                });
            return Promise.resolve({
                source: DataSource.MemoryCache,
                result: memoryCacheEntry.payload
            });
        }
    }

    public async fetchAndSaveInCacheIfExpired<T>(request: AjaxRequest, source: DataSource, cacheEntry?: CachedData<T> | undefined): Promise<DataResponse<T>> {
        if (cacheEntry === undefined || (new Date()).getTime() > new Date(cacheEntry.expirationDateTime).getTime()) {
            try {
                this.startPerformanceInsight(request.id!, DataSource.HttpRequest);
                const value: AxiosResponse<T> = await this.fetchWithAjax<T>(request);
                this.setDataSize(this.stopPerformanceInsight(request.id!, DataSource.HttpRequest), value.data);
                if (value.status >= 200 && value.status <= 399) {
                    this.logInfo({ action: DataAction.Fetch, id: request.id!, source: DataSource.HttpRequest, performanceInsight: this.getPerformanceInsight(request.id!) });
                    return this.saveCache(request, {
                        source: DataSource.HttpRequest,
                        result: value.data
                    });
                } else {
                    throw Error("Cannot cache request that are not in the range of 200 or in the range of 300.");
                }
            } catch (error) {
                this.stopPerformanceInsight(this.getPerformanceInsight(request.id!), DataSource.HttpRequest);
                this.logError({ error: error, source: DataSource.HttpRequest, action: DataAction.Fetch });
                throw error;
            };
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

    public async tryPersistentStorageFetching<T>(request: AjaxRequest): Promise<DataResponse<T> | undefined> {
        if (this.options.isCacheEnabled === false || request.persistentCache === undefined) {
            return undefined;
        }
        try {
            const persistentStorageValue = await this.getPersistentStoreData<T>(request.id!);
            if (persistentStorageValue !== undefined) {
                const localStorageCacheEntry = persistentStorageValue;
                if (new Date().getTime() > (new Date(localStorageCacheEntry.expirationDateTime)).getTime()) {
                    this.deleteFromPersistentStorage(request.id!);
                } else {
                    this.logInfo(
                        {
                            action: DataAction.Use,
                            id: request.id!,
                            source: DataSource.PersistentStorageCache,
                            performanceInsight: this.setDataSize(this.getPerformanceInsight(request.id!), localStorageCacheEntry.payload)
                        });
                    return {
                        source: DataSource.PersistentStorageCache,
                        result: localStorageCacheEntry.payload
                    };
                }
            }
            return Promise.resolve(undefined);
        } catch (reason) {
            this.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Use });
            return undefined;
        }
    }

    public ajax(request: AxiosRequestConfig): AxiosPromise<any> {
        return axios(request);
    }
    public fetchWithAjax<T>(request: AjaxRequest): AxiosPromise<T> {
        // Check if already on-going request
        const cacheOnGoingEntry: OnGoingAjaxRequest | undefined = this.onGoingAjaxRequest.get(request.id!);
        if (cacheOnGoingEntry === undefined) {
            // Execute Ajax call
            // Add listener to remove from onGoing once we receive a success or failure from the request
            const promiseAjaxResponse = this.ajax(request.request)
                .then((response: AxiosResponse<T>) => {
                    this.deleteOnGoingAjaxRequest(request.id!);
                    return response;
                }).catch((reason) => {
                    this.deleteOnGoingAjaxRequest(request.id!);
                    throw reason;
                });
            // Add into the on-going queue
            this.addOnGoingAjaxRequest(request.id!, request, promiseAjaxResponse);
            return promiseAjaxResponse;
        } else {
            // Already on-going fetching, return the response promise from previous request.
            this.logInfo({ id: request.id!, source: DataSource.HttpRequest, action: DataAction.WaitingOnGoingRequest, performanceInsight: this.getPerformanceInsight(request.id!) });
            return cacheOnGoingEntry.promise;
        }
    }
    public getActualTimeTick(): number {
        return window.performance.now();
    }
    public getPerformanceInsight(requestId: string): PerformanceRequestInsight {
        let existing = this.performanceInsights.get(requestId);
        if (existing === undefined) {
            const newPerformanceInsight: PerformanceRequestInsight = {
                fetch: {
                    startMs: 0,
                    stopMs: 0
                }
            };
            this.performanceInsights.set(requestId, newPerformanceInsight);
            existing = newPerformanceInsight;

        }
        return existing;
    }
    public startPerformanceInsight(insight: PerformanceRequestInsight, source?: DataSource): PerformanceRequestInsight;
    public startPerformanceInsight(requestId: string, source?: DataSource): PerformanceRequestInsight;
    public startPerformanceInsight(insightOrRequestId: PerformanceRequestInsight | string, source?: DataSource): PerformanceRequestInsight {
        let insight: PerformanceRequestInsight;
        if (typeof insightOrRequestId === "string") {
            insight = this.getPerformanceInsight(insightOrRequestId);
        } else {
            insight = insightOrRequestId;
        }
        const startTime = this.getActualTimeTick();
        const performanceMarker = { startMs: startTime };

        if (source === undefined) {
            insight.fetch = performanceMarker;
        } else {
            switch (source) {
                case DataSource.HttpRequest:
                    insight.httpRequest = performanceMarker;
                    break;
                case DataSource.MemoryCache:
                    insight.memoryCache = performanceMarker;
                    break;
                case DataSource.PersistentStorageCache:
                    insight.persistentStorageCache = performanceMarker;
                    break;
                case DataSource.System:
                    // Nothing to do
                    break;
                default:
                    this.exhaustiveCheck(source);
            }
        }
        return insight;
    }
    public stopPerformanceInsight(insight: PerformanceRequestInsight, source?: DataSource): PerformanceRequestInsight;
    public stopPerformanceInsight(requestId: string, source?: DataSource): PerformanceRequestInsight;
    public stopPerformanceInsight(insightOrRequestId: PerformanceRequestInsight | string, source?: DataSource): PerformanceRequestInsight {
        let insight: PerformanceRequestInsight;
        if (typeof insightOrRequestId === "string") {
            insight = this.getPerformanceInsight(insightOrRequestId);
        } else {
            insight = insightOrRequestId;
        }
        const stopTime = this.getActualTimeTick();
        if (source === undefined) {
            insight.fetch.stopMs = stopTime;
        } else {
            switch (source) {
                case DataSource.HttpRequest:
                    if (insight.httpRequest !== undefined) {
                        insight.httpRequest.stopMs = stopTime;
                    }
                    break;
                case DataSource.MemoryCache:
                    if (insight.memoryCache !== undefined) {
                        insight.memoryCache.stopMs = stopTime;
                    }
                    break;
                case DataSource.PersistentStorageCache:
                    if (insight.persistentStorageCache !== undefined) {
                        insight.persistentStorageCache.stopMs = stopTime;
                    }
                    break;
                case DataSource.System:
                    // Nothing to do
                    break;
                default:
                    this.exhaustiveCheck(source);
            }
        }
        return insight;
    }
    public exhaustiveCheck(source: never): never {
        throw Error("Missing source: " + source);
    }

    public deletePerformanceInsight(id: string): void {
        this.performanceInsights.delete(id);
    }

    public setDataSize<T>(insight: PerformanceRequestInsight, data: T): PerformanceRequestInsight {
        if (data !== undefined) {
            insight.dataSizeInBytes = JSON.stringify(data).length;
        }
        return insight;
    }

    public deleteFromMemoryCache(id: string): void {
        this.logInfo({ id: id, source: DataSource.MemoryCache, action: DataAction.Delete, performanceInsight: this.getPerformanceInsight(id) });
        this.cachedResponse.delete(id);
    }

    public addOnGoingAjaxRequest<T>(id: string, request: AjaxRequest, promiseAjaxResponse: Promise<AxiosResponse<T>>): void {
        this.logInfo({ id: id, source: DataSource.HttpRequest, action: DataAction.AddFromOnGoingRequest, performanceInsight: this.getPerformanceInsight(id) });
        this.onGoingAjaxRequest.set(request.id!, {
            ajaxRequest: request,
            promise: promiseAjaxResponse
        });
    }
    public deleteOnGoingAjaxRequest(id: string): void {
        this.logInfo({ id: id, source: DataSource.HttpRequest, action: DataAction.RemoveFromOnGoingRequest, performanceInsight: this.getPerformanceInsight(id) });
        this.onGoingAjaxRequest.delete(id);
    }

    public addInMemoryCache<T>(id: string, lifespanInSeconds: number, dataToAdd: T): void {
        const currentUTCDataWithLifeSpanAdded = new Date((new Date()).getTime() + lifespanInSeconds * 1000);
        this.cachedResponse.set(id, JSON.stringify({
            expirationDateTime: currentUTCDataWithLifeSpanAdded,
            payload: dataToAdd
        }));
        this.logInfo({ id: id, source: DataSource.MemoryCache, action: DataAction.Save, performanceInsight: this.getPerformanceInsight(id) });
    }

    public addInPersistentStore<T>(id: string, cacheData: CachedData<T>): void {
        try {
            if (this.openIndexDb === undefined) {
                return;
            }
            this.openIndexDb.transaction("rw!", this.openIndexDb.data, () => {
                if (this.openIndexDb === undefined) {
                    return;
                }
                const putPromise = this.openIndexDb.data.put({ id: id, ...cacheData }).then(() => {
                    this.logInfo({ id: id, source: DataSource.PersistentStorageCache, action: DataAction.Save, performanceInsight: this.getPerformanceInsight(id) });
                }).catch((e) => {
                    this.logError({ error: e, source: DataSource.PersistentStorageCache, action: DataAction.Save });
                });
                return putPromise;
            }).catch(e => {
                this.logError({ error: e, source: DataSource.PersistentStorageCache, action: DataAction.Save });
            });
        } catch (reason) {
            this.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Save });
        }
    }
    public getMemoryStoreData<T>(id: string): CachedData<T> | undefined {
        this.startPerformanceInsight(id, DataSource.MemoryCache);
        const cacheValue = this.cachedResponse.get(id);
        this.stopPerformanceInsight(id, DataSource.MemoryCache);
        this.logInfo({ action: DataAction.Fetch, id: id, source: DataSource.MemoryCache, performanceInsight: this.getPerformanceInsight(id) });
        if (cacheValue === undefined) {
            return undefined;
        }
        return JSON.parse(cacheValue) as CachedData<T>;
    }
    public async getPersistentStoreData<T>(id: string): Promise<CacheDataWithId<T> | undefined> {
        try {
            if (this.openIndexDb === undefined) {
                return undefined;
            }
            this.startPerformanceInsight(id, DataSource.PersistentStorageCache);
            const resultPromise = await this.openIndexDb.data.get(id);
            this.stopPerformanceInsight(id, DataSource.PersistentStorageCache);
            this.logInfo({ action: DataAction.Fetch, id: id, source: DataSource.PersistentStorageCache, performanceInsight: this.getPerformanceInsight(id) });
            return resultPromise;
        }
        catch (reason) {
            this.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Fetch });
            return undefined;
        }
    }

    public async deleteFromPersistentStorage(id: string): Promise<void> {
        try {
            if (this.openIndexDb === undefined) {
                return;
            }
            return this.openIndexDb.data.delete(id);
        } catch (reason) {
            this.logError({ error: reason, source: DataSource.PersistentStorageCache, action: DataAction.Delete });
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
