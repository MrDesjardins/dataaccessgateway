import axios, { AxiosError, AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import Dexie from "dexie";
import { AjaxRequest, AjaxRequestExecute, AjaxRequestInternal, AjaxRequestWithCache, CacheDataWithId, CachedData, CachedType, DataAction, DataDualResponse, DataResponse, DataSource, FetchType, HttpMethod, LogError, LogInfo, OnGoingAjaxRequest, PerformanceRequestInsight } from "./model";
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
    onBackgroundAjaxFetchFailure: (response: AxiosResponse | AxiosError) => void;
}

/**
 * The role of this interface is to limit what is public. This allow to have almost every
 * functions public in the concrete class which ease the unitestability of the code and
 * preserve a define set of available feature through the singleton with the interface.
 */
export interface IDataAccessSingleton {
    setConfiguration(options?: Partial<DataAccessSingletonOptions>): void;
    fetch<T extends CachedType>(fetchType: FetchType, request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchFast<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchWeb<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchFastAndFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataDualResponse<T>>;
    deleteDataFromCache(request: AjaxRequest, options?: DeleteCacheOptions): Promise<void>;
    deleteAllDataFromAllCache(): Promise<void>;
    deletePersistentStorage(name: string): Promise<void>;
    forceDeleteAndFetch<T extends CachedType>(
        request: AjaxRequestWithCache,
        options?: DeleteCacheOptions
    ): Promise<DataResponse<T>>;
    execute<T extends CachedType>(request: AjaxRequestExecute): Promise<DataResponse<T>>;
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
        alterObjectBeforeHashing: undefined,
        onBackgroundAjaxFetchFailure: () => {
            /*Nothing*/
        }
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
                error: e,
                httpMethod: undefined
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

    public fetch<T extends CachedType>(fetchType: FetchType, request: AjaxRequestWithCache): Promise<DataResponse<T>> {
        switch (fetchType) {
            case FetchType.Fast:
                return this.fetchFast(request);
            case FetchType.Fresh:
                return this.fetchFresh(request);
            case FetchType.Web:
                return this.fetchWeb(request);
            case FetchType.Execute:
                return this.execute(request);
            case FetchType.FastAndFresh:
                return this.fetchFastAndFresh(request);
        }
    }
    public async fetchWeb<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.Web); // Default values
        this.startPerformanceInsight(requestInternal.id);
        try {
            const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                requestInternal,
                DataSource.HttpRequest
            );
            this.stopPerformanceInsight(this.getPerformanceInsight(requestInternal.id));
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestInternal.id), response.result),
                dataSignature: this.writeSignature(response.result),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: this.getCurrentDateTimeMs() - response.webFetchDateTimeMs
            });
            this.deletePerformanceInsight(requestInternal.id);
            return response;
        } catch (reason) {
            this.deletePerformanceInsight(requestInternal.id);
            throw reason;
        }
    }
    /**
     * Go in the memory cache first, then the persisted cache. In all level of cache, if the data is outdated it will fetch and
     * wait the response to cache it and return it. It means that each time the data is obsolete that the fetch takes time but
     * subsequent request will be faster. This function focus on accuracy first.
     */
    public async fetchFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.Fresh); // Default values
        this.setDefaultFastCache(requestInternal); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(requestInternal.id); // Full fetch performance
        this.startPerformanceInsight(requestInternal.id, DataSource.MemoryCache); // Performance for memory only
        const memoryCacheValue: CachedData<T> | undefined = this.tryMemoryCacheFetching<T>(requestInternal);
        this.stopPerformanceInsight(requestInternal.id, DataSource.MemoryCache); // Performance for memory only is stopped
        const currentDateTimeMs = this.getCurrentDateTimeMs();
        if (memoryCacheValue !== undefined && currentDateTimeMs <= memoryCacheValue.expirationDateTimeMs) {
            this.stopPerformanceInsight(requestInternal.id); // Stop performance for the whole fetch
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.MemoryCache,
                performanceInsight: this.setDataSize(
                    this.getPerformanceInsight(requestInternal.id),
                    memoryCacheValue.payload
                ),
                dataSignature: this.writeSignature(memoryCacheValue.payload),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: this.getCurrentDateTimeMs() - memoryCacheValue.webFetchDateTimeMs
            });
            this.deletePerformanceInsight(requestInternal.id);
            return this.saveCache(requestInternal, {
                source: DataSource.MemoryCache,
                result: memoryCacheValue.payload,
                webFetchDateTimeMs: memoryCacheValue.webFetchDateTimeMs
            });
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
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod,
                    dataAgeMs: this.getCurrentDateTimeMs() - persistentCacheValue.webFetchDateTimeMs
                });
                this.deletePerformanceInsight(requestInternal.id);
                return this.saveCache(requestInternal, {
                    source: DataSource.PersistentStorageCache,
                    result: persistentCacheValue.result,
                    webFetchDateTimeMs: persistentCacheValue.webFetchDateTimeMs
                });
            }
        } catch (reason) {
            this.stopPerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
            this.deletePerformanceInsight(requestInternal.id);
            throw reason;
        }

        try {
            this.startPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            const value: AxiosResponse<T> = await this.fetchWithAjax<T>(requestInternal);
            this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            this.stopPerformanceInsight(requestInternal.id); // Overall performance off
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestInternal.id), value.data),
                dataSignature: this.writeSignature(value.data),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: 0
            });
            this.deletePerformanceInsight(requestInternal.id);
            return this.saveCache(requestInternal, {
                source: DataSource.HttpRequest,
                result: value.data,
                webFetchDateTimeMs: this.getCurrentDateTimeMs()
            });
        } catch (reason) {
            this.stopPerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: reason,
                source: DataSource.HttpRequest,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
            this.deletePerformanceInsight(requestInternal.id);
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
    public async fetchFast<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.Fast); // Default values
        this.setDefaultFastCache(requestInternal); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(requestInternal.id);

        // If the flag is off, we skip and go directly to the Ajax
        if (!this.options.isCacheEnabled) {
            try {
                const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                    requestInternal,
                    DataSource.HttpRequest
                );
                this.stopPerformanceInsight(requestInternal.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.HttpRequest,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        response.result
                    ),
                    dataSignature: this.writeSignature(response.result),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod,
                    dataAgeMs: this.getCurrentDateTimeMs() - response.webFetchDateTimeMs
                });
                this.deletePerformanceInsight(requestInternal.id);
                return response;
            } catch (error) {
                this.stopPerformanceInsight(requestInternal.id);
                this.logError({
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    error: error,
                    source: DataSource.HttpRequest,
                    action: DataAction.Fetch,
                    performanceInsight: this.getPerformanceInsight(requestInternal.id),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod
                });
                this.deletePerformanceInsight(requestInternal.id);
                throw error;
            }
        }

        // Check memory cache first
        const memoryCacheEntry: CachedData<T> | undefined = this.tryMemoryCacheFetching(requestInternal);
        if (memoryCacheEntry === undefined) {
            let persistentStorageValue: CachedData<T> | undefined = undefined;
            // Not in memory, check in long term storage
            try {
                persistentStorageValue = await this.getPersistentStoreData<T>(requestInternal);
            } catch (error) {
                this.stopPerformanceInsight(requestInternal.id);
                this.deletePerformanceInsight(requestInternal.id);
                // We do not log error because the function getPersistentStoreData is already covering the persistence error log
                // We do not throw, the value will be undefined and Ajax will kick in
            }
            if (persistentStorageValue === undefined) {
                // Not in the persistent storage means we must fetch from API
                try {
                    const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                        requestInternal,
                        DataSource.HttpRequest
                    );
                    this.stopPerformanceInsight(requestInternal.id);
                    this.logInfo({
                        action: DataAction.Use,
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        source: DataSource.HttpRequest,
                        performanceInsight: this.setDataSize(
                            this.getPerformanceInsight(requestInternal.id),
                            response.result
                        ),
                        dataSignature: this.writeSignature(response.result),
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod,
                        dataAgeMs: this.getCurrentDateTimeMs() - response.webFetchDateTimeMs
                    });
                    this.deletePerformanceInsight(requestInternal.id);
                    return response;
                } catch (error) {
                    this.stopPerformanceInsight(requestInternal.id);
                    this.deletePerformanceInsight(requestInternal.id);
                    // We do not log error because the function getPersistentStoreData is already covering the persistence error log
                    throw error;
                }
            } else {
                // We have something from the persistent cache
                const persistentStorageEntry = persistentStorageValue;
                if (requestInternal.memoryCache !== undefined && requestInternal.memoryCache !== null) {
                    this.addInMemoryCache(requestInternal, persistentStorageEntry.payload);
                }
                // It might be expired which mean we fetch to get fresh data HOWEVER, we will return the obsolete data to have a fast response
                try {
                    this.fetchAndSaveInCacheIfExpired<T>(
                        requestInternal,
                        DataSource.PersistentStorageCache,
                        persistentStorageEntry
                    );
                } catch (e) {
                    /* We have handle it enought for this case of background call */
                }
                // Return the persistent storage even if expired
                this.stopPerformanceInsight(requestInternal.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.PersistentStorageCache,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        persistentStorageEntry.payload
                    ),
                    dataSignature: this.writeSignature(persistentStorageEntry.payload),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod,
                    dataAgeMs: this.getCurrentDateTimeMs() - persistentStorageEntry.webFetchDateTimeMs
                });
                this.deletePerformanceInsight(requestInternal.id);
                return Promise.resolve({
                    source: DataSource.PersistentStorageCache,
                    result: persistentStorageEntry.payload,
                    webFetchDateTimeMs: persistentStorageEntry.webFetchDateTimeMs
                });
            }
        } else {
            try {
                this.fetchAndSaveInCacheIfExpired<T>(requestInternal, DataSource.MemoryCache, memoryCacheEntry); // We have something in the memory, but we might still want to fetch if expire for future requests
            } catch (e) {
                /* We have handle it enought for this case of background call */
            }
            this.stopPerformanceInsight(requestInternal.id, DataSource.MemoryCache);
            this.stopPerformanceInsight(requestInternal.id);
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.MemoryCache,
                performanceInsight: this.setDataSize(
                    this.getPerformanceInsight(requestInternal.id),
                    memoryCacheEntry.payload
                ),
                dataSignature: this.writeSignature(memoryCacheEntry.payload),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: this.getCurrentDateTimeMs() - memoryCacheEntry.webFetchDateTimeMs
            });
            this.deletePerformanceInsight(requestInternal.id);
            return Promise.resolve({
                source: DataSource.MemoryCache,
                result: memoryCacheEntry.payload,
                webFetchDateTimeMs: memoryCacheEntry.webFetchDateTimeMs
            });
        }
    }

    public async fetchFastAndFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataDualResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.FastAndFresh); // Default values
        this.setDefaultFastCache(requestInternal); // We enforce a minimum memory cache of few seconds
        this.startPerformanceInsight(requestInternal.id);

        // If the flag is off, we skip and go directly to the Ajax
        if (!this.options.isCacheEnabled) {
            try {
                const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                    requestInternal,
                    DataSource.HttpRequest
                );
                this.stopPerformanceInsight(requestInternal.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.HttpRequest,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        response.result
                    ),
                    dataSignature: this.writeSignature(response.result),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod,
                    dataAgeMs: this.getCurrentDateTimeMs() - response.webFetchDateTimeMs,
                    useIsIntermediate: false
                });
                this.deletePerformanceInsight(requestInternal.id);
                return {
                    ...response,
                    webPromise: undefined
                };
            } catch (error) {
                this.stopPerformanceInsight(requestInternal.id);
                this.logError({
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    error: error,
                    source: DataSource.HttpRequest,
                    action: DataAction.Fetch,
                    performanceInsight: this.getPerformanceInsight(requestInternal.id),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod
                });
                this.deletePerformanceInsight(requestInternal.id);
                throw error;
            }
        }

        // Check memory cache first
        const memoryCacheEntry: CachedData<T> | undefined = this.tryMemoryCacheFetching(requestInternal);
        if (memoryCacheEntry === undefined) {
            let persistentStorageValue: CachedData<T> | undefined = undefined;
            // Not in memory, check in long term storage
            try {
                persistentStorageValue = await this.getPersistentStoreData<T>(requestInternal);
            } catch (error) {
                this.stopPerformanceInsight(requestInternal.id);
                this.deletePerformanceInsight(requestInternal.id);
                // We do not log error because the function getPersistentStoreData is already covering the persistence error log
                // We do not throw, the value will be undefined and Ajax will kick in
            }
            if (persistentStorageValue === undefined) {
                // Not in the persistent storage means we must fetch from API
                try {
                    const response: DataResponse<T> = await this.fetchAndSaveInCacheIfExpired<T>(
                        requestInternal,
                        DataSource.HttpRequest
                    );
                    this.stopPerformanceInsight(requestInternal.id);
                    this.logInfo({
                        action: DataAction.Use,
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        source: DataSource.HttpRequest,
                        performanceInsight: this.setDataSize(
                            this.getPerformanceInsight(requestInternal.id),
                            response.result
                        ),
                        dataSignature: this.writeSignature(response.result),
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod,
                        dataAgeMs: this.getCurrentDateTimeMs() - response.webFetchDateTimeMs,
                        useIsIntermediate: false
                    });
                    this.deletePerformanceInsight(requestInternal.id);
                    return {
                        ...response,
                        webPromise: undefined // undefined because the response promise is the web
                    };
                } catch (error) {
                    this.stopPerformanceInsight(requestInternal.id);
                    this.deletePerformanceInsight(requestInternal.id);
                    // We do not log error because the function getPersistentStoreData is already covering the persistence error log
                    throw error;
                }
            } else {
                // We have something from the persistent cache
                const persistentStorageEntry = persistentStorageValue;
                if (requestInternal.memoryCache !== undefined && requestInternal.memoryCache !== null) {
                    this.addInMemoryCache(requestInternal, persistentStorageEntry.payload);
                }
                // It's expired which mean we fetch to get fresh data HOWEVER, we will return the obsolete data to have a fast response
                const responseWeb = this.fetchAndSaveInCacheIfExpired<T>(
                    requestInternal,
                    DataSource.PersistentStorageCache,
                    persistentStorageEntry
                );

                if (this.isPromise(responseWeb)) {
                    responseWeb.then((dataResponse: DataResponse<T>) => {
                        this.logInfo({
                            action: DataAction.Use,
                            id: requestInternal.id,
                            url: requestInternal.request.url!,
                            source: dataResponse.source,
                            performanceInsight: this.setDataSize(
                                this.getPerformanceInsight(requestInternal.id),
                                dataResponse.result
                            ),
                            dataSignature: this.writeSignature(dataResponse.result),
                            fetchType: requestInternal.fetchType,
                            httpMethod: requestInternal.httpMethod,
                            dataAgeMs: 0,
                            useIsIntermediate: false
                        });
                    });
                }
                // Return the persistent storage even if expired
                this.stopPerformanceInsight(requestInternal.id);
                this.logInfo({
                    action: DataAction.Use,
                    id: requestInternal.id,
                    url: requestInternal.request.url!,
                    source: DataSource.PersistentStorageCache,
                    performanceInsight: this.setDataSize(
                        this.getPerformanceInsight(requestInternal.id),
                        persistentStorageEntry.payload
                    ),
                    dataSignature: this.writeSignature(persistentStorageEntry.payload),
                    fetchType: requestInternal.fetchType,
                    httpMethod: requestInternal.httpMethod,
                    dataAgeMs: this.getCurrentDateTimeMs() - persistentStorageEntry.webFetchDateTimeMs,
                    useIsIntermediate: true
                });
                this.deletePerformanceInsight(requestInternal.id);
                const responseDual: DataDualResponse<T> = {
                    source: DataSource.PersistentStorageCache,
                    result: persistentStorageEntry.payload,
                    webFetchDateTimeMs: persistentStorageEntry.webFetchDateTimeMs,
                    webPromise: this.isPromise(responseWeb) ? responseWeb : undefined
                };
                return Promise.resolve(responseDual);
            }
        } else {
            const responseWeb = this.fetchAndSaveInCacheIfExpired<T>(
                requestInternal,
                DataSource.MemoryCache,
                memoryCacheEntry
            ); // We have something in the memory, but we might still want to fetch if expire for future requests

            if (this.isPromise(responseWeb)) {
                responseWeb.then((dataResponse: DataResponse<T>) => {
                    this.logInfo({
                        action: DataAction.Use,
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        source: dataResponse.source,
                        performanceInsight: this.setDataSize(
                            this.getPerformanceInsight(requestInternal.id),
                            dataResponse.result
                        ),
                        dataSignature: this.writeSignature(dataResponse.result),
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod,
                        dataAgeMs: 0,
                        useIsIntermediate: false
                    });
                });
            }
            this.stopPerformanceInsight(requestInternal.id, DataSource.MemoryCache);
            this.stopPerformanceInsight(requestInternal.id);
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.MemoryCache,
                performanceInsight: this.setDataSize(
                    this.getPerformanceInsight(requestInternal.id),
                    memoryCacheEntry.payload
                ),
                dataSignature: this.writeSignature(memoryCacheEntry.payload),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: this.getCurrentDateTimeMs() - memoryCacheEntry.webFetchDateTimeMs,
                useIsIntermediate: true
            });
            this.deletePerformanceInsight(requestInternal.id);
            const responseDual: DataDualResponse<T> = {
                source: DataSource.MemoryCache,
                result: memoryCacheEntry.payload,
                webFetchDateTimeMs: memoryCacheEntry.webFetchDateTimeMs,
                webPromise: this.isPromise(responseWeb) ? responseWeb : undefined
            };
            return Promise.resolve(responseDual);
        }
    }
    public isPromise<T extends CachedType>(
        o: Promise<DataResponse<T>> | DataResponse<T>
    ): o is Promise<DataResponse<T>> {
        return (o as any).then;
    }
    /**
     * fetchAndSaveInCacheIfExpired verifies if the data in the cache entry is expired. If it is, it performs
     * an Ajax call to get a fresh version and saves it in the cache. If the data is not expired, it returns
     * a resolved promise with the cache entry. Ideally, it should return the cacheEntry without wrapping it
     * in a Promise but a function returning a Promise<Entity> | Entity is disallowed with async/await.
     *
     * This cause an issue with the fetchFastAndFresh because it returns the promise of this function in the result
     * (in the webPromise) which might NOT be a web promise but a cache promise. It forces the user to have to
     * consult the DataSource to ensure that the Promise returned is from the web.
     */
    public fetchAndSaveInCacheIfExpired<T extends CachedType>(
        requestInternal: AjaxRequestInternal,
        source: DataSource,
        cacheEntry?: CachedData<T> | undefined
    ): Promise<DataResponse<T>> | DataResponse<T> {
        const ERROR_HANDLED_MSG = "Cannot cache request that are not in the range of 200 or in the range of 300.";
        if (cacheEntry === undefined || this.getCurrentDateTimeMs() > cacheEntry.expirationDateTimeMs) {
            this.startPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            return this.fetchWithAjax<T>(requestInternal)
                .then((value: AxiosResponse<T>) => {
                    this.setDataSize(
                        this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest),
                        value.data
                    );
                    if (value.status >= 200 && value.status <= 399) {
                        this.logInfo({
                            action: DataAction.Fetch,
                            id: requestInternal.id,
                            url: requestInternal.request.url!,
                            source: DataSource.HttpRequest,
                            performanceInsight: this.getPerformanceInsight(requestInternal.id),
                            dataSignature: this.writeSignature(value.data),
                            fetchType: requestInternal.fetchType,
                            httpMethod: requestInternal.httpMethod,
                            dataAgeMs: 0
                        });
                        return this.saveCache(requestInternal, {
                            source: DataSource.HttpRequest,
                            result: value.data,
                            webFetchDateTimeMs: this.getCurrentDateTimeMs()
                        });
                    } else {
                        this.options.onBackgroundAjaxFetchFailure(value);
                        throw Error(ERROR_HANDLED_MSG);
                    }
                })
                .catch(error => {
                    this.stopPerformanceInsight(this.getPerformanceInsight(requestInternal.id), DataSource.HttpRequest);
                    this.logError({
                        id: requestInternal.id,
                        url: requestInternal.request.url!,
                        error: error,
                        source: DataSource.HttpRequest,
                        action: DataAction.Fetch,
                        performanceInsight: this.getPerformanceInsight(requestInternal.id),
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod
                    });
                    if (error.message !== ERROR_HANDLED_MSG) {
                        // To improve. At the moment, trick to avoid double sending
                        this.options.onBackgroundAjaxFetchFailure(error);
                    }
                    throw error;
                });
        } else {
            return {
                source: source, // This might be from the persistent storage as well
                result: cacheEntry.payload,
                webFetchDateTimeMs: cacheEntry.webFetchDateTimeMs
            };
        }
    }
    public generateId(request: AjaxRequestWithCache): string {
        return this.hashCode(
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
        return { id: request.id, fetchType: fetchType, httpMethod: request.request.method as HttpMethod, ...request };
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

    public saveCache<T extends CachedType>(
        requestInternal: AjaxRequestInternal,
        responseFromCacheOrAjax: DataResponse<T>
    ): Promise<DataResponse<T>> {
        // At the end, we check if we need to store in any of the cache
        if (requestInternal.memoryCache !== undefined && requestInternal.memoryCache !== null) {
            this.addInMemoryCache(requestInternal, responseFromCacheOrAjax.result);
        }
        if (requestInternal.persistentCache !== undefined && requestInternal.persistentCache !== null) {
            const expiredDateTimeMs =
                responseFromCacheOrAjax.webFetchDateTimeMs + requestInternal.persistentCache.lifespanInSeconds * 1000;

            const cachedData: CachedData<T> = {
                expirationDateTimeMs: expiredDateTimeMs,
                payload: responseFromCacheOrAjax.result,
                webFetchDateTimeMs: responseFromCacheOrAjax.webFetchDateTimeMs
            };
            this.addInPersistentStore(requestInternal, cachedData);
        }
        return Promise.resolve(responseFromCacheOrAjax);
    }

    public tryMemoryCacheFetching<T>(requestInternal: AjaxRequestInternal): CachedData<T> | undefined {
        if (
            this.options.isCacheEnabled === false ||
            requestInternal.memoryCache === undefined ||
            requestInternal.memoryCache === null
        ) {
            return undefined;
        }
        const cacheEntry: CachedData<T> | undefined = this.getMemoryStoreData(requestInternal);
        if (cacheEntry !== undefined) {
            // If expired, fetch
            if (this.getCurrentDateTimeMs() > cacheEntry.expirationDateTimeMs) {
                // Delete from cache
                this.deleteFromMemoryCache(requestInternal);
            }

            // Return the cached response
            return cacheEntry;
        }
        return undefined;
    }

    public async tryPersistentStorageFetching<T extends CachedType>(
        requestInternal: AjaxRequestInternal
    ): Promise<DataResponse<T> | undefined> {
        if (
            this.options.isCacheEnabled === false ||
            requestInternal.persistentCache === undefined ||
            requestInternal.persistentCache === null
        ) {
            return undefined;
        }
        try {
            const persistentStorageValue = await this.getPersistentStoreData<T>(requestInternal);
            if (persistentStorageValue !== undefined) {
                const localStorageCacheEntry = persistentStorageValue;
                if (this.getCurrentDateTimeMs() > localStorageCacheEntry.expirationDateTimeMs) {
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
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod,
                        dataAgeMs: this.getCurrentDateTimeMs() - localStorageCacheEntry.webFetchDateTimeMs
                    });
                    return {
                        source: DataSource.PersistentStorageCache,
                        result: localStorageCacheEntry.payload,
                        webFetchDateTimeMs: localStorageCacheEntry.webFetchDateTimeMs
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
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
            return undefined;
        }
    }

    public ajax(request: AxiosRequestConfig): AxiosPromise<any> {
        return axios(request);
    }
    public fetchWithAjax<T extends CachedType>(requestInternal: AjaxRequestInternal): AxiosPromise<T> {
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
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: undefined
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
                    stopMs: 0,
                    elapsedMs: 0
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
            insight.fetch.elapsedMs = insight.fetch.stopMs - insight.fetch.startMs;
        } else {
            switch (source) {
                case DataSource.HttpRequest:
                    if (insight.httpRequest !== undefined) {
                        insight.httpRequest.stopMs = stopTime;
                        insight.httpRequest.elapsedMs = insight.httpRequest.stopMs - insight.httpRequest.startMs;
                    }
                    break;
                case DataSource.MemoryCache:
                    if (insight.memoryCache !== undefined) {
                        insight.memoryCache.stopMs = stopTime;
                        insight.memoryCache.elapsedMs = insight.memoryCache.stopMs - insight.memoryCache.startMs;
                    }
                    break;
                case DataSource.PersistentStorageCache:
                    if (insight.persistentStorageCache !== undefined) {
                        insight.persistentStorageCache.stopMs = stopTime;
                        insight.persistentStorageCache.elapsedMs = insight.persistentStorageCache.stopMs - insight.persistentStorageCache.startMs;
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
            fetchType: requestInternal.fetchType,
            httpMethod: requestInternal.httpMethod,
            dataAgeMs: undefined
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
            fetchType: requestInternal.fetchType,
            httpMethod: requestInternal.httpMethod,
            dataAgeMs: undefined
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
            fetchType: requestInternal.fetchType,
            httpMethod: requestInternal.httpMethod,
            dataAgeMs: undefined
        });
        this.onGoingAjaxRequest.delete(requestInternal.id);
    }

    public addInMemoryCache<T extends CachedType>(requestInternal: AjaxRequestInternal, dataToAdd: T): void {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        const lifespanInSeconds = requestInternal.memoryCache!.lifespanInSeconds;
        const currentDateTimeMs = this.getCurrentDateTimeMs();
        const currentUTCDataWithLifeSpanAdded = currentDateTimeMs + lifespanInSeconds * 1000;
        const cacheData: CachedData<T> = {
            expirationDateTimeMs: currentUTCDataWithLifeSpanAdded,
            payload: dataToAdd,
            webFetchDateTimeMs: currentDateTimeMs
        };
        this.cachedResponse.set(id, JSON.stringify(cacheData));
        this.logInfo({
            id: id,
            url: url,
            source: DataSource.MemoryCache,
            action: DataAction.Save,
            performanceInsight: this.getPerformanceInsight(id),
            dataSignature: this.writeSignature(dataToAdd),
            fetchType: requestInternal.fetchType,
            httpMethod: requestInternal.httpMethod,
            dataAgeMs: undefined
        });
    }

    public async addInPersistentStore<T extends CachedType>(
        requestInternal: AjaxRequestInternal,
        cacheData: CachedData<T>
    ): Promise<void> {
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
                    try {
                        this.openIndexDb.data.put({ id: id, url: url, ...cacheData });
                        this.logInfo({
                            id: id,
                            url: url,
                            source: DataSource.PersistentStorageCache,
                            action: DataAction.Save,
                            performanceInsight: this.getPerformanceInsight(id),
                            dataSignature: this.writeSignature(cacheData.payload),
                            fetchType: requestInternal.fetchType,
                            httpMethod: requestInternal.httpMethod,
                            dataAgeMs: undefined
                        });
                        return;
                    } catch (e) {
                        this.logError({
                            id: id,
                            url: url,
                            error: e,
                            source: DataSource.PersistentStorageCache,
                            action: DataAction.Save,
                            performanceInsight: this.getPerformanceInsight(id),
                            fetchType: requestInternal.fetchType,
                            httpMethod: requestInternal.httpMethod
                        });
                        throw e;
                    }
                })
                .catch((e: any) => {
                    this.logError({
                        id: id,
                        url: url,
                        error: e,
                        source: DataSource.PersistentStorageCache,
                        action: DataAction.Save,
                        performanceInsight: this.getPerformanceInsight(id),
                        fetchType: requestInternal.fetchType,
                        httpMethod: requestInternal.httpMethod
                    });
                    throw e;
                });
        } catch (reason) {
            this.logError({
                id: id,
                url: url,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Save,
                performanceInsight: this.getPerformanceInsight(id),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
        }
    }
    public getMemoryStoreData<T>(requestInternal: AjaxRequestInternal): CachedData<T> | undefined {
        const id = requestInternal.id;
        const url = requestInternal.request.url!;
        this.startPerformanceInsight(id, DataSource.MemoryCache);
        const cacheValue = this.cachedResponse.get(id);
        this.stopPerformanceInsight(id, DataSource.MemoryCache);
        const logInfoData: LogInfo = {
            kind: "LogInfo",
            action: DataAction.Fetch,
            id: id,
            url: url,
            source: DataSource.MemoryCache,
            performanceInsight: this.getPerformanceInsight(id),
            dataSignature: this.writeSignature(cacheValue === undefined ? undefined : JSON.parse(cacheValue)),
            fetchType: requestInternal.fetchType,
            httpMethod: requestInternal.httpMethod,
            dataAgeMs: undefined // Redefined below
        };
        if (cacheValue === undefined) {
            this.logInfo({ ...logInfoData, dataAgeMs: undefined });
            return undefined;
        }
        const parsedCacheValue = JSON.parse(cacheValue) as CachedData<T>;
        this.logInfo({ ...logInfoData, dataAgeMs: this.getCurrentDateTimeMs() - parsedCacheValue.webFetchDateTimeMs });
        return parsedCacheValue;
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
                dataSignature: this.writeSignature(resultPromise === undefined ? undefined : resultPromise.payload),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs:
                    resultPromise === undefined
                        ? undefined
                        : this.getCurrentDateTimeMs() - resultPromise.webFetchDateTimeMs
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
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
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

            const deleted = await this.openIndexDb.data.delete(id);
            this.logInfo({
                id: id,
                url: url,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Delete,
                performanceInsight: this.getPerformanceInsight(id),
                dataSignature: undefined,
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: undefined
            });
            return deleted;
        } catch (reason) {
            this.logError({
                id: id,
                url: url,
                error: reason,
                source: DataSource.PersistentStorageCache,
                action: DataAction.Delete,
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
            throw reason;
        }
    }

    public async forceDeleteAndFetch<T extends CachedType>(
        request: AjaxRequestWithCache,
        options?: DeleteCacheOptions
    ): Promise<DataResponse<T>> {
        await this.deleteDataFromCache(request, options);
        return await this.fetchWeb<T>(request);
    }
    public deleteDataFromCache(request: AjaxRequest, options?: DeleteCacheOptions): Promise<void> {
        const requestInternal = this.setDefaultRequestValues(request, undefined); // Default values (Doesn't matter about "Fast" here)
        if (options === undefined) {
            this.deleteFromMemoryCache(requestInternal);
            return this.deleteFromPersistentStorage(requestInternal);
        } else {
            let promise: Promise<void> | undefined = undefined;
            if (options.memory !== undefined && options.memory === true) {
                this.deleteFromMemoryCache(requestInternal);
            }
            if (options.persistent !== undefined && options.persistent === true) {
                promise = this.deleteFromPersistentStorage(requestInternal);
            }
            if (promise === undefined) {
                promise = Promise.resolve();
            }
            return promise;
        }
    }
    public deleteAllDataFromAllCache(): Promise<void> {
        // 1) Delete from the memory cache
        this.cachedResponse.clear();

        // 2) Delete from the persistent storage (IndexDb)
        if (this.openIndexDb !== undefined) {
            let promises: Promise<void>[] = [];
            this.openIndexDb.tables.forEach(dexieTable => promises.push(dexieTable.clear()));
            return Promise.all(promises).then(() => {
                return;
            });
        } else {
            return Promise.resolve();
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
                action: DataAction.System,
                httpMethod: undefined
            });
            throw reason;
        }
    }

    public writeSignature<T extends CachedType>(payload: T): string {
        if (!this.generateSignature) {
            return "";
        }
        let objToHash = payload;
        if (this.options.alterObjectBeforeHashing) {
            objToHash = this.options.alterObjectBeforeHashing(payload);
        }
        return this.hashCode(objToHash);
    }

    public async execute<T extends CachedType>(request: AjaxRequestExecute): Promise<DataResponse<T>> {
        const requestInternal = this.setDefaultRequestValues(request, FetchType.Execute); // Default values
        this.startPerformanceInsight(requestInternal.id);
        this.startPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
        try {
            const response: AxiosResponse<T> = await this.fetchWithAjax<T>(requestInternal);
            this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            this.stopPerformanceInsight(requestInternal.id);
            this.logInfo({
                action: DataAction.Use,
                id: requestInternal.id,
                url: requestInternal.request.url!,
                source: DataSource.HttpRequest,
                performanceInsight: this.setDataSize(this.getPerformanceInsight(requestInternal.id), response.data),
                dataSignature: this.writeSignature(response.data),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod,
                dataAgeMs: 0
            });
            this.deletePerformanceInsight(requestInternal.id);
            this.invalidateRequests(request);
            return {
                source: DataSource.HttpRequest,
                result: response.data,
                webFetchDateTimeMs: this.getCurrentDateTimeMs()
            };
        } catch (error) {
            this.stopPerformanceInsight(requestInternal.id, DataSource.HttpRequest);
            this.stopPerformanceInsight(requestInternal.id);
            this.logError({
                id: requestInternal.id,
                url: requestInternal.request.url!,
                error: error,
                source: DataSource.HttpRequest,
                action: DataAction.Fetch,
                performanceInsight: this.getPerformanceInsight(requestInternal.id),
                fetchType: requestInternal.fetchType,
                httpMethod: requestInternal.httpMethod
            });
            throw error;
        }
    }

    public invalidateRequests(request: AjaxRequestExecute): void {
        if (request.invalidateRequests !== undefined) {
            request.invalidateRequests.forEach(req => {
                if (request.forceInvalidateAndRefresh === undefined || request.forceInvalidateAndRefresh === false) {
                    this.deleteDataFromCache(req);
                } else {
                    this.forceDeleteAndFetch(req);
                }
            });
        }
    }

    public hashCode(toHash: CachedType): string {
        let str: string;
        if (typeof toHash === "string") {
            str = toHash;
        } else {
            str = JSON.stringify(toHash);
        }
        var hash = 0;
        if (str.length == 0) {
            return str;
        }
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    public getCurrentDateTimeMs(): number {
        return new Date().valueOf();
    }
}
const DataAccessGateway: (databaseName: string) => IDataAccessSingleton = (databaseName: string = "DatabaseName") =>
    DataAccessSingleton.getInstance(databaseName);
export default DataAccessGateway;
