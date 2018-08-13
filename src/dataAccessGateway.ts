import axios, { AxiosResponse } from "axios";
import Dexie from "dexie";
import hash from "object-hash";
import { AjaxRequest, AjaxRequestInternal, CacheDataWithId, CachedData, DataAction, DataResponse, DataSource, FetchType, LogError, LogInfo, OnGoingAjaxRequest, PerformanceRequestInsight } from "./model";
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
    alterObjectBeforeHashing?: <T>(obj: T) => any;
}

/**
 * The role of this interface is to limit what is public. This allow to have almost every
 * functions public in the concrete class which ease the unitestability of the code and
 * preserve a define set of available feature through the singleton with the interface.
 */
export interface IDataAccessSingleton {
    setConfiguration(options?: Partial<DataAccessSingletonOptions>): void;
    fetch<T>(fetchType: FetchType, request: AjaxRequest): Promise<DataResponse<T>>;
    fetchFresh<T>(request: AjaxRequest): Promise<DataResponse<T>>;
    fetchFast<T>(request: AjaxRequest): Promise<DataResponse<T>>;
    fetchWeb<T>(request: AjaxRequest): Promise<DataResponse<T>>;
    deleteDataFromCache(request: AjaxRequest, options?: DeleteCacheOptions): void;
    deletePersistentStorage(name: string): Promise<void>;
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
    public generateSignature: boolean = false;
    public DefaultOptions: Readonly<DataAccessSingletonOptions> = {
        isCacheEnabled: true,
        isCacheMandatoryIfEnabled: true,
        defaultLifeSpanInSeconds: 5 * 60,
        logError: () => {
            /*Nothing*/
        },
        logInfo: () => {
            /*Nothing*/
        },
        alterObjectBeforeHashing: undefined
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
            this.logError({
                id: "",
                url: "",
                action: DataAction.System,
                source: DataSource.System,
                error: e
            });
        }

        // Listen to message and scope down to only these coming from the DAG Chrome extension that
        // is an action. For the data.id "signature" we use the value to turn on or off the generation
        // of a signature.
        window.addEventListener(
            "message",
            (event: MessageEvent) => {
                this.onListenMessage(event);
            },
            false
        );
    }

    public onListenMessage(event: MessageEvent): void {
        if (event.data) {
            if (event.data.source === "dataaccessgateway-devtools" && event.data.name === "action") {
                if (event.data.data.id === "signature") {
                    this.generateSignature = event.data.data.value;
                }
            }
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
            window.postMessage(
                {
                    source: "dataaccessgateway-agent",
                    payload: requestInfo
                },
                "*"
            );
        }
    }
    public logError(error: Pick<LogError, Exclude<keyof LogError, "kind">>): void {
        const requestError: LogError = { ...error, kind: "LogError" };
        this.options.logError(requestError);
        if (window) {
            window.postMessage(
                {
                    source: "dataaccessgateway-agent",
                    payload: {
                        action: error.action,
                        source: error.source,
                        kind: "LogError",
                        id: error.id,
                        performanceInsight: error.performanceInsight
                    }
                },
                "*"
            );
        }
    }

    public setConfiguration(options?: Partial<DataAccessSingletonOptions>): void {
        if (options !== undefined) {
            this.options = { ...this.DefaultOptions, ...this.options, ...options };
        }
    }

    public fetch<T>(fetchType: FetchType, request: AjaxRequest): Promise<DataResponse<T>> {
        switch (fetchType) {
            case FetchType.Fast:
                return this.fetchFast(request);
            case FetchType.Fresh:
                return this.fetchFresh(request);
            case FetchType.Web:
                return this.fetchWeb(request);
        }
    }
    public async fetchWeb<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        const requestTyped = this.setDefaultRequestValues(request, FetchType.Web); // Default values
        this.startPerformanceInsight(requestTyped.id);
        try {
            const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                requestTyped,
                DataSource.HttpRequest
            );
            this.stopPerformanceInsight(this.getPerformanceInsight(requestTyped.id));
            this.logInfo({
                action: DataAction.Use,
                id: requestTyped.id,
                url: requestTyped.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestTyped.id), response.result),
                dataSignature: this.writeSignature(response.result),
                fetchType: requestTyped.fetchType
            });
            this.deletePerformanceInsight(requestTyped.id);
            return response;
        } catch (reason) {
            this.deletePerformanceInsight(requestTyped.id);
            throw reason;
        }
    }
    /**
     * Go in the memory cache first, then the persisted cache. In all level of cache, if the data is outdated it will fetch and
     * wait the response to cache it and return it. It means that each time the data is obsolete that the fetch takes time but
     * subsequent request will be faster. This function focus on accuracy first.
     */
    public async fetchFresh<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.Fresh); // Default values
        this.setDefaultCache(requestInternal); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(requestInternal.id); // Full fetch performance
        try {
            this.startPerformanceInsight(requestInternal.id, DataSource.MemoryCache); // Performance for memory only
            const memoryCacheValue: DataResponse<T> | undefined = await this.tryMemoryCacheFetching<T>(requestInternal);
            this.stopPerformanceInsight(requestInternal.id, DataSource.MemoryCache); // Performance for memory only is stopped
            if (memoryCacheValue !== undefined) {
                this.stopPerformanceInsight(requestInternal.id); // Stop performance for the whole fetch
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.MemoryCache,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        memoryCacheValue.result
                    ),
                    dataSignature: this.writeSignature(memoryCacheValue.result),
                    fetchType: requestInternal.fetchType
                });
                this.deletePerformanceInsight(requestInternal.id);
                return this.saveCache(requestInternal, {
                    source: DataSource.MemoryCache,
                    result: memoryCacheValue.result
                });
            }
        } catch (reason) {
            this.deletePerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.MemoryCache,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType
            });
            throw reason;
        }

        try {
            this.startPerformanceInsight(requestInternal.id, DataSource.PersistentStorageCache);
            const persistentCacheValue: DataResponse<T> | undefined = await this.tryPersistentStorageFetching<T>(
                requestInternal
            );
            this.stopPerformanceInsight(requestInternal.id, DataSource.PersistentStorageCache);
            if (persistentCacheValue !== undefined) {
                this.stopPerformanceInsight(requestInternal.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.PersistentStorageCache,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        persistentCacheValue.result
                    ),
                    dataSignature: this.writeSignature(persistentCacheValue.result),
                    fetchType: requestInternal.fetchType
                });
                this.deletePerformanceInsight(requestInternal.id);
                return this.saveCache(requestInternal, {
                    source: DataSource.PersistentStorageCache,
                    result: persistentCacheValue.result
                });
            }
        } catch (reason) {
            this.deletePerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType
            });
            throw reason;
        }

        try {
            this.startPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            const value: AxiosResponse<T> = await this.fetchWithAjax<T>(requestInternal);
            this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            this.stopPerformanceInsight(requestInternal.id);
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestInternal.id), value.data),
                dataSignature: this.writeSignature(value.data),
                fetchType: requestInternal.fetchType
            });
            this.deletePerformanceInsight(requestInternal.id);
            return this.saveCache(requestInternal, {
                source: DataSource.HttpRequest,
                result: value.data
            });
        } catch (reason) {
            // this.deletePerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.HttpRequest,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType
            });
            throw reason;
        }
    }

    /**
     * Fetch fast always returns the data from the cache if available. It returns data that can be obsolete, older than the lifetime
     * specified in the configuration. The lifespan specified is only to indicate when the data must be refreshed which mean that
     * an obsolete value is returned but the system will do the Ajax call to get it for the NEXT invocation. It is important to
     * understand that the fetch fast principle is that it's better to return a stale value than nothing BUT will respect the lifespan
     * to fetch the new value. Fetch fast works better if most of the data (if not all) is stored with a persistence
     */
    public async fetchFast<T>(request: AjaxRequest): Promise<DataResponse<T>> {
        const requestTyped = this.setDefaultRequestValues(request, FetchType.Fast); // Default values
        this.setDefaultFastCache(requestTyped); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(requestTyped.id);

        // If the flag is off, we skip and go directly to the Ajax
        if (!this.options.isCacheEnabled) {
            const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                requestTyped,
                DataSource.HttpRequest
            );
            this.stopPerformanceInsight(requestTyped.id, DataSource.HttpRequest);
            this.logInfo({
                action: DataAction.Use,
                id: requestTyped.id,
                url: requestTyped.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestTyped.id), response.result),
                dataSignature: this.writeSignature(response.result),
                fetchType: requestTyped.fetchType
            });
            return response;
        }

        // Check memory cache first
        const memoryCacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(requestTyped);
        if (memoryCacheEntry === undefined) {
            // Not in memory, check in long term storage
            const persistentStorageValue: CachedData<{}> | undefined = await this.getPersistentStoreData(requestTyped);

            if (persistentStorageValue === undefined) {
                // Not in the persistent storage means we must fetch from API
                const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(requestTyped, DataSource.HttpRequest);
                this.stopPerformanceInsight(requestTyped.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestTyped.id,
                    url: requestTyped.request.url!,
                    source: DataSource.HttpRequest,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestTyped.id),
                        response.result
                    ),
                    dataSignature: this.writeSignature(response.result),
                    fetchType: requestTyped.fetchType
                });
                return response;
            } else {
                // We have something from the persistent cache
                const persistentStorageEntry = persistentStorageValue as CachedData<T>;
                if (requestTyped.memoryCache !== undefined) {
                    this.addInMemoryCache(requestTyped, persistentStorageEntry.payload);
                }
                this.fetchAndSaveInCacheIfExpired<T>(
                    requestTyped,
                    DataSource.PersistentStorageCache,
                    persistentStorageEntry
                ); // It's expired which mean we fetch to get fresh data HOWEVER, we will return the obsolete data to have a fast response
                // Return the persistent storage even if expired
                this.stopPerformanceInsight(requestTyped.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestTyped.id,
                    url: requestTyped.request.url!,
                    source: DataSource.PersistentStorageCache,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestTyped.id),
                        persistentStorageEntry.payload
                    ),
                    dataSignature: this.writeSignature(persistentStorageEntry.payload),
                    fetchType: requestTyped.fetchType
                });
                return Promise.resolve({
                    source: DataSource.PersistentStorageCache,
                    result: persistentStorageEntry.payload
                });
            }
        } else {
            this.fetchAndSaveInCacheIfExpired<T>(requestTyped, DataSource.MemoryCache, memoryCacheEntry); // We have something in the memory, but we might still want to fetch if expire for future requests
            this.stopPerformanceInsight(requestTyped.id, DataSource.MemoryCache);
            this.stopPerformanceInsight(requestTyped.id);
            this.logInfo({
                action: DataAction.Use,
                id: requestTyped.id,
                url: requestTyped.request.url!,
                source: DataSource.MemoryCache,
                performanceInsight: this.setDataSize(
                    this.getPerformanceInsight(requestTyped.id),
                    memoryCacheEntry.payload
                ),
                dataSignature: this.writeSignature(memoryCacheEntry.payload),
                fetchType: requestTyped.fetchType
            });
            return Promise.resolve({
                source: DataSource.MemoryCache,
                result: memoryCacheEntry.payload
            });
        }
    }

    public async fetchAndSaveInCacheIfExpired<T>(
        requestInternal: AjaxRequestInternal,
        source: DataSource,
        cacheEntry?: CachedData<T> | undefined
    ): Promise<DataResponse<T>> {
        if (cacheEntry === undefined || new Date().getTime() > new Date(cacheEntry.expirationDateTime).getTime()) {
            try {
                this.startPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
                const value: AxiosResponse<T> = await this.fetchWithAjax<T>(requestInternal);
                this.setDataSize(this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest), value.data);
                if (value.status >= 200 && value.status <= 399) {
                    this.logInfo({
                        action: DataAction.Fetch,
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        source: DataSource.HttpRequest,
                        performanceInsight: this.getPerformanceInsight(requestInternal.id),
                        dataSignature: this.writeSignature(value.data),
                        fetchType: requestInternal.fetchType
                    });
                    return this.saveCache(requestInternal, {
                        source: DataSource.HttpRequest,
                        result: value.data
                    });
                } else {
                    throw Error("Cannot cache request that are not in the range of 200 or in the range of 300.");
                }
            } catch (error) {
                this.stopPerformanceInsight(this.getPerformanceInsight(requestInternal.id), DataSource.HttpRequest);
                this.logError({
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    error: error,
                    source: DataSource.HttpRequest,
                    action: DataAction.Fetch,
                    performanceInsight: this.getPerformanceInsight(requestInternal.id),
                    fetchType: requestInternal.fetchType
                });
                throw error;
            }
        } else {
            return Promise.resolve({
                source: source, // This might be from the persistent storage as well
                result: cacheEntry.payload
            });
        }
    }
    public generateId(request: AjaxRequest): string {
        return hash.sha1(
            JSON.stringify({
                id: request.id,
                params: request.request.params,
                method: request.request.method,
                url: request.request.url,
                baseURL: request.request.baseURL,
                data: request.request.data
            })
        );
    }

    public setDefaultRequestValues(request: AjaxRequest, fetchType?: FetchType): AjaxRequestInternal {
        if (request.id === undefined) {
            request.id = this.generateId(request);
        }
        return { id: request.id, fetchType: fetchType, ...request };
    }

    public setDefaultCache(requestInternal: AjaxRequestInternal): void {
        if (requestInternal.memoryCache === undefined && this.options.isCacheMandatoryIfEnabled) {
            requestInternal.memoryCache = {
                lifespanInSeconds: this.options.defaultLifeSpanInSeconds
            }; // Provide ALWAYS a minimum memory cache with small life
        }
    }
    public setDefaultFastCache(requestInternal: AjaxRequestInternal): void {
        this.setDefaultCache(requestInternal);
        if (requestInternal.persistentCache === undefined && this.options.isCacheMandatoryIfEnabled) {
            requestInternal.persistentCache = {
                lifespanInSeconds: this.options.defaultLifeSpanInSeconds
            }; // Provide ALWAYS a minimum memory cache with small life
        }
    }

    public saveCache<T>(
        requestInternal: AjaxRequestInternal,
        responseFromCacheOrAjax: DataResponse<T>
    ): Promise<DataResponse<T>> {
        // At the end, we check if we need to store in any of the cache
        if (requestInternal.memoryCache !== undefined) {
            this.addInMemoryCache(requestInternal, responseFromCacheOrAjax.result);
        }
        if (requestInternal.persistentCache !== undefined) {
            const currentUTCDataWithLifeSpanAdded = new Date(
                new Date().getTime() + requestInternal.persistentCache.lifespanInSeconds * 1000
            );
            const cachedData: CachedData<T> = {
                expirationDateTime: currentUTCDataWithLifeSpanAdded,
                payload: responseFromCacheOrAjax.result
            };
            this.addInPersistentStore(requestInternal, cachedData);
        }
        return Promise.resolve(responseFromCacheOrAjax);
    }

    public tryMemoryCacheFetching<T>(requestInternal: AjaxRequestInternal): Promise<DataResponse<T> | undefined> {
        if (this.options.isCacheEnabled === false || requestInternal.memoryCache === undefined) {
            return Promise.resolve(undefined);
        }
        const cacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(requestInternal);
        if (cacheEntry !== undefined) {
            // If expired, fetch
            if (new Date().getTime() > new Date(cacheEntry.expirationDateTime).getTime()) {
                // Delete from cache
                this.deleteFromMemoryCache(requestInternal);
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

    public async tryPersistentStorageFetching<T>(
        requestInternal: AjaxRequestInternal
    ): Promise<DataResponse<T> | undefined> {
        if (this.options.isCacheEnabled === false || requestInternal.persistentCache === undefined) {
            return undefined;
        }
        try {
            const persistentStorageValue = await this.getPersistentStoreData<T>(requestInternal);
            if (persistentStorageValue !== undefined) {
                const localStorageCacheEntry = persistentStorageValue;
                if (new Date().getTime() > new Date(localStorageCacheEntry.expirationDateTime).getTime()) {
                    this.deleteFromPersistentStorage(requestInternal);
                } else {
                    this.logInfo({
                        action: DataAction.Use,
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        source: DataSource.PersistentStorageCache,
                        performanceInsight: this.setDataSize(
                            this.getPerformanceInsight(requestInternal.id),
                            localStorageCacheEntry.payload
                        ),
                        dataSignature: this.writeSignature(localStorageCacheEntry.payload),
                        fetchType: requestInternal.fetchType
                    });
                    return {
                        source: DataSource.PersistentStorageCache,
                        result: localStorageCacheEntry.payload
                    };
                }
            }
            return Promise.resolve(undefined);
        } catch (reason) {
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Use,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType
            });
            return undefined;
        }
    }

    public ajax(request: AxiosRequestConfig): AxiosPromise<any> {
        return axios(request);
    }
    public fetchWithAjax<T>(requestInternal: AjaxRequestInternal): AxiosPromise<T> {
        // Check if already on-going request
        const cacheOnGoingEntry: OnGoingAjaxRequest | undefined = this.onGoingAjaxRequest.get(requestInternal.id);
        if (cacheOnGoingEntry === undefined) {
            // Execute Ajax call
            // Add listener to remove from onGoing once we receive a success or failure from the request
            const promiseAjaxResponse = this.ajax(requestInternal.request)
                .then((response: AxiosResponse<T>) => {
                    this.deleteOnGoingAjaxRequest(requestInternal);
                    return response;
                })
                .catch(reason => {
                    this.deleteOnGoingAjaxRequest(requestInternal);
                    throw reason;
                });
            // Add into the on-going queue
            this.addOnGoingAjaxRequest(requestInternal, promiseAjaxResponse);
            return promiseAjaxResponse;
        } else {
            // Already on-going fetching, return the response promise from previous request.
            this.logInfo({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.HttpRequest,
                action: DataAction.WaitingOnGoingRequest,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                dataSignature: undefined,
                fetchType: requestInternal.fetchType
            });
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
    public startPerformanceInsight(
        insightOrRequestId: PerformanceRequestInsight | string,
        source?: DataSource
    ): PerformanceRequestInsight {
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
    public stopPerformanceInsight(
        insightOrRequestId: PerformanceRequestInsight | string,
        source?: DataSource
    ): PerformanceRequestInsight {
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

    public deleteFromMemoryCache(requestInternal: AjaxRequestInternal): void {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        this.logInfo({
            id: id,
            url: url,
            source: DataSource.MemoryCache,
            action: DataAction.Delete,
            performanceInsight: this.getPerformanceInsight(id),
            dataSignature: undefined,
            fetchType: requestInternal.fetchType
        });
        this.cachedResponse.delete(id);
    }

    public addOnGoingAjaxRequest<T>(
        requestInternal: AjaxRequestInternal,
        promiseAjaxResponse: Promise<AxiosResponse<T>>
    ): void {
        this.logInfo({
            id: requestInternal.id,
            url: requestInternal.request.url!,
            source: DataSource.HttpRequest,
            action: DataAction.AddFromOnGoingRequest,
            performanceInsight: this.getPerformanceInsight(requestInternal.id),
            dataSignature: undefined,
            fetchType: requestInternal.fetchType
        });
        this.onGoingAjaxRequest.set(requestInternal.id, {
            ajaxRequest: requestInternal,
            promise: promiseAjaxResponse
        });
    }
    public deleteOnGoingAjaxRequest(requestInternal: AjaxRequestInternal): void {
        this.logInfo({
            id: requestInternal.id,
            url: requestInternal.request.url!,
            source: DataSource.HttpRequest,
            action: DataAction.RemoveFromOnGoingRequest,
            performanceInsight: this.getPerformanceInsight(requestInternal.id),
            dataSignature: undefined,
            fetchType: requestInternal.fetchType
        });
        this.onGoingAjaxRequest.delete(requestInternal.id);
    }

    public addInMemoryCache<T>(requestInternal: AjaxRequestInternal, dataToAdd: T): void {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        const lifespanInSeconds = requestInternal.memoryCache!.lifespanInSeconds;
        const currentUTCDataWithLifeSpanAdded = new Date(new Date().getTime() + lifespanInSeconds * 1000);
        this.cachedResponse.set(
            id,
            JSON.stringify({
                expirationDateTime: currentUTCDataWithLifeSpanAdded,
                payload: dataToAdd
            })
        );
        this.logInfo({
            id: id,
            url: url,
            source: DataSource.MemoryCache,
            action: DataAction.Save,
            performanceInsight: this.getPerformanceInsight(id),
            dataSignature: this.writeSignature(dataToAdd),
            fetchType: requestInternal.fetchType
        });
    }

    public addInPersistentStore<T>(requestInternal: AjaxRequestInternal, cacheData: CachedData<T>): void {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        try {
            if (this.openIndexDb === undefined) {
                return;
            }
            this.openIndexDb
                .transaction("rw!", this.openIndexDb.data, () => {
                    if (this.openIndexDb === undefined) {
                        return;
                    }
                    const putPromise = this.openIndexDb.data
                        .put({ id: id, url: url, ...cacheData })
                        .then(() => {
                            this.logInfo({
                                id: id,
                                url: url,
                                source: DataSource.PersistentStorageCache,
                                action: DataAction.Save,
                                performanceInsight: this.getPerformanceInsight(id),
                                dataSignature: this.writeSignature(cacheData.payload),
                                fetchType: requestInternal.fetchType
                            });
                        })
                        .catch((e: any) => {
                            this.logError({
                                id: id,
                                url: url,
                                error: e,
                                source: DataSource.PersistentStorageCache,
                                action: DataAction.Save,
                                performanceInsight: this.getPerformanceInsight(id),
                                fetchType: requestInternal.fetchType
                            });
                        });
                    return putPromise;
                })
                .catch((e: any) => {
                    this.logError({
                        id: id,
                        url: url,
                        error: e,
                        source: DataSource.PersistentStorageCache,
                        action: DataAction.Save,
                        performanceInsight: this.getPerformanceInsight(id),
                        fetchType: requestInternal.fetchType
                    });
                });
        } catch (reason) {
            this.logError({
                id: id,
                url: url,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Save,
                performanceInsight: this.getPerformanceInsight(id),
                fetchType: requestInternal.fetchType
            });
        }
    }
    public getMemoryStoreData<T>(requestInternal: AjaxRequestInternal): CachedData<T> | undefined {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        this.startPerformanceInsight(id, DataSource.MemoryCache);
        const cacheValue = this.cachedResponse.get(id);
        this.stopPerformanceInsight(id, DataSource.MemoryCache);
        this.logInfo({
            action: DataAction.Fetch,
            id: id,
            url: url,
            source: DataSource.MemoryCache,
            performanceInsight: this.getPerformanceInsight(id),
            dataSignature: this.writeSignature(cacheValue === undefined ? "" : JSON.parse(cacheValue)),
            fetchType: requestInternal.fetchType
        });
        if (cacheValue === undefined) {
            return undefined;
        }
        return JSON.parse(cacheValue) as CachedData<T>;
    }
    public async getPersistentStoreData<T>(
        requestInternal: AjaxRequestInternal
    ): Promise<CacheDataWithId<T> | undefined> {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        try {
            if (this.openIndexDb === undefined) {
                return undefined;
            }
            this.startPerformanceInsight(id, DataSource.PersistentStorageCache);
            const resultPromise = await this.openIndexDb.data.get(id);
            this.stopPerformanceInsight(id, DataSource.PersistentStorageCache);
            this.logInfo({
                action: DataAction.Fetch,
                id: id,
                url: url,
                source: DataSource.PersistentStorageCache,
                performanceInsight: this.getPerformanceInsight(id),
                dataSignature: this.writeSignature(resultPromise === undefined ? "" : resultPromise.payload),
                fetchType: requestInternal.fetchType
            });
            return resultPromise;
        } catch (reason) {
            this.stopPerformanceInsight(id, DataSource.PersistentStorageCache);
            this.logError({
                id: id,
                url: url,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(id),
                fetchType: requestInternal.fetchType
            });
            return undefined;
        }
    }

    public async deleteFromPersistentStorage(requestInternal: AjaxRequestInternal): Promise<void> {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        try {
            if (this.openIndexDb === undefined) {
                return;
            }
            return this.openIndexDb.data.delete(id);
        } catch (reason) {
            this.logError({
                id: id,
                url: url,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Delete,
                fetchType: requestInternal.fetchType
            });
        }
    }

    public deleteDataFromCache(request: AjaxRequest, options?: DeleteCacheOptions): void {
        const requestInternal = this.setDefaultRequestValues(request, undefined); // Default values (Doesn't matter about "Fast" here)
        if (options === undefined) {
            this.deleteFromMemoryCache(requestInternal);
            this.deleteFromPersistentStorage(requestInternal);
        } else {
            if (options.memory !== undefined && options.memory === true) {
                this.deleteFromMemoryCache(requestInternal);
            }
            if (options.persistent !== undefined && options.persistent === true) {
                this.deleteFromPersistentStorage(requestInternal);
            }
        }
    }
    public async deletePersistentStorage(name: string): Promise<void> {
        try {
            return await Dexie.delete(name);
        } catch (reason) {
            this.logError({
                id: "",
                url: "",
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.System
            });
        }
    }

    public writeSignature<T>(payload: T): string {
        if (!this.generateSignature) {
            return "";
        }
        let objToHash = payload;
        if (this.options.alterObjectBeforeHashing) {
            objToHash = this.options.alterObjectBeforeHashing(payload);
        }
        return hash.sha1(objToHash);
    }
}
const DataAccessGateway: (databaseName: string) => IDataAccessSingleton = (databaseName: string = "DatabaseName") =>
    DataAccessSingleton.getInstance(databaseName);
export default DataAccessGateway;
