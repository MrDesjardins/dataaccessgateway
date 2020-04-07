import { AxiosError, AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import Dexie from "dexie";
import { AjaxRequest, AjaxRequestExecute, AjaxRequestInternal, AjaxRequestWithCache, CacheDataWithId, CachedData, CachedType, DataDualResponse, DataResponse, DataSource, FetchType, LogError, LogInfo, OnGoingAjaxRequest, PerformanceRequestInsight } from "./model";
export declare class DataAccessIndexDbDatabase extends Dexie {
    data: Dexie.Table<CacheDataWithId<any>, string>;
    constructor(databaseName: string);
    dropTable(): Promise<void>;
}
export interface DataAccessSingletonOptions {
    isCacheEnabled: boolean;
    isCacheMandatoryIfEnabled: boolean;
    defaultLifeSpanInSeconds: number;
    logError: (error: LogError) => void;
    logInfo: (info: LogInfo) => void;
    alterObjectBeforeHashing?: <T>(obj: T) => any;
    onBackgroundAjaxFetchFailure: (response: AxiosResponse | AxiosError) => void;
    onBeforeAjaxRequest: (request: AxiosRequestConfig) => void;
    onAfterAjaxRequest: (request: AxiosRequestConfig) => void;
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
    forceDeleteAndFetch<T extends CachedType>(request: AjaxRequestWithCache, options?: DeleteCacheOptions): Promise<DataResponse<T>>;
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
export declare class DataAccessSingleton implements IDataAccessSingleton {
    private static instance;
    generateSignature: boolean;
    DefaultOptions: Readonly<DataAccessSingletonOptions>;
    options: DataAccessSingletonOptions;
    onGoingAjaxRequest: Map<string, OnGoingAjaxRequest>;
    performanceInsights: Map<string, PerformanceRequestInsight>;
    cachedResponse: Map<string, string>;
    openIndexDb?: DataAccessIndexDbDatabase;
    constructor(databaseName: string);
    onListenMessage(event: MessageEvent): void;
    static getInstance(databaseName: string): IDataAccessSingleton;
    logInfo(info: Pick<LogInfo, Exclude<keyof LogInfo, "kind">>): void;
    logError(error: Pick<LogError, Exclude<keyof LogError, "kind">>): void;
    setConfiguration(options?: Partial<DataAccessSingletonOptions>): void;
    fetch<T extends CachedType>(fetchType: FetchType, request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchWeb<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    /**
     * Go in the memory cache first, then the persisted cache. In all level of cache, if the data is outdated it will fetch and
     * wait the response to cache it and return it. It means that each time the data is obsolete that the fetch takes time but
     * subsequent request will be faster. This function focus on accuracy first.
     */
    fetchFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    /**
     * Fetch fast always returns the data from the cache if available. It returns data that can be obsolete, older than the lifetime
     * specified in the configuration. The lifespan specified is only to indicate when the data must be refreshed which mean that
     * an obsolete value is returned but the system will do the Ajax call to get it for the NEXT invocation. It is important to
     * understand that the fetch fast principle is that it's better to return a stale value than nothing BUT will respect the lifespan
     * to fetch the new value. Fetch fast works better if most of the data (if not all) is stored with a persistence
     */
    fetchFast<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataResponse<T>>;
    fetchFastAndFresh<T extends CachedType>(request: AjaxRequestWithCache): Promise<DataDualResponse<T>>;
    isPromise<T extends CachedType>(o: Promise<DataResponse<T>> | DataResponse<T>): o is Promise<DataResponse<T>>;
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
    fetchAndSaveInCacheIfExpired<T extends CachedType>(requestInternal: AjaxRequestInternal, source: DataSource, cacheEntry?: CachedData<T> | undefined): Promise<DataResponse<T>> | DataResponse<T>;
    generateId(request: AjaxRequestWithCache): string;
    setDefaultRequestValues(request: AjaxRequest, fetchType?: FetchType): AjaxRequestInternal;
    setDefaultCache(requestInternal: AjaxRequestInternal): void;
    setDefaultFastCache(requestInternal: AjaxRequestInternal): void;
    saveCache<T extends CachedType>(requestInternal: AjaxRequestInternal, responseFromCacheOrAjax: DataResponse<T>): Promise<DataResponse<T>>;
    tryMemoryCacheFetching<T>(requestInternal: AjaxRequestInternal): CachedData<T> | undefined;
    tryPersistentStorageFetching<T extends CachedType>(requestInternal: AjaxRequestInternal): Promise<DataResponse<T> | undefined>;
    ajax(request: AxiosRequestConfig): AxiosPromise<any>;
    fetchWithAjax<T extends CachedType>(requestInternal: AjaxRequestInternal): AxiosPromise<T>;
    getActualTimeTick(): number;
    getPerformanceInsight(requestId: string): PerformanceRequestInsight;
    startPerformanceInsight(insight: PerformanceRequestInsight, source?: DataSource): PerformanceRequestInsight;
    startPerformanceInsight(requestId: string, source?: DataSource): PerformanceRequestInsight;
    stopPerformanceInsight(insight: PerformanceRequestInsight, source?: DataSource): PerformanceRequestInsight;
    stopPerformanceInsight(requestId: string, source?: DataSource): PerformanceRequestInsight;
    exhaustiveCheck(source: never): never;
    deletePerformanceInsight(id: string): void;
    setDataSize<T>(insight: PerformanceRequestInsight, data: T): PerformanceRequestInsight;
    deleteFromMemoryCache(requestInternal: AjaxRequestInternal): void;
    addOnGoingAjaxRequest<T>(requestInternal: AjaxRequestInternal, promiseAjaxResponse: Promise<AxiosResponse<T>>): void;
    deleteOnGoingAjaxRequest(requestInternal: AjaxRequestInternal): void;
    addInMemoryCache<T extends CachedType>(requestInternal: AjaxRequestInternal, dataToAdd: T): void;
    addInPersistentStore<T extends CachedType>(requestInternal: AjaxRequestInternal, cacheData: CachedData<T>): Promise<void>;
    getMemoryStoreData<T>(requestInternal: AjaxRequestInternal): CachedData<T> | undefined;
    getPersistentStoreData<T>(requestInternal: AjaxRequestInternal): Promise<CacheDataWithId<T> | undefined>;
    deleteFromPersistentStorage(requestInternal: AjaxRequestInternal): Promise<void>;
    forceDeleteAndFetch<T extends CachedType>(request: AjaxRequestWithCache, options?: DeleteCacheOptions): Promise<DataResponse<T>>;
    deleteDataFromCache(request: AjaxRequest, options?: DeleteCacheOptions): Promise<void>;
    deleteAllDataFromAllCache(): Promise<void>;
    deletePersistentStorage(name: string): Promise<void>;
    writeSignature<T extends CachedType>(payload: T): string;
    execute<T extends CachedType>(request: AjaxRequestExecute): Promise<DataResponse<T>>;
    invalidateRequests(request: AjaxRequestExecute): void;
    hashCode(toHash: CachedType): string;
    getCurrentDateTimeMs(): number;
}
declare const DataAccessGateway: (databaseName: string) => IDataAccessSingleton;
export default DataAccessGateway;
