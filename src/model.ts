import { AxiosRequestConfig } from "axios";

export type CachedType = string | object;

export enum FetchType {
    Fast = "Fast",
    Fresh = "Fresh",
    Web = "Web",
    FastAndFresh = "FastAndWeb",
    Execute = "Execute",
    FastAndFreshObject = "FastAndFreshObject"
}
export enum HttpMethod {
    NONE = "NONE",
    GET = "GET",
    HEAD = "HEAD",
    POST = "POST",
    PUT = "PUT",
    DELETE = "DELETE",
    CONNECT = "CONNECT",
    OPTIONS = "OPTIONS",
    TRACE = "TRACE",
    PATCH = "PATCH"
}

export interface CacheConfiguration {
    lifespanInSeconds: number;
}
export interface AjaxRequest {
    /**
     * Identifier of the request. Need to be unique. If not provided, the hash of request is used
     */
    id?: string;
    request: AxiosRequestConfig;
}
export interface AjaxRequestExecute extends AjaxRequest {
    invalidateRequests?: AjaxRequest[];
    forceInvalidateAndRefresh?: boolean;
}
export interface AjaxRequestWithCache extends RequestWithCache, AjaxRequest {

}

export interface AjaxRequestInternal extends AjaxRequestWithCache {
    id: string;
    fetchType: FetchType | undefined;
    httpMethod: HttpMethod;
}
export interface RequestWithCache {
    /**
    * The memory cache configuration. It contains the lifespan before ejecting the data from the cache.
    * When not defined is set to X seconds (see constant in the class)
    * When explicitly set to NULL, the request is not cached even if the option 'isCacheMandatoryIfEnabled' is set to true
    */
    memoryCache?: CacheConfiguration | null;
    /**
     * When defined, the data is set into the persistent storage. Subsequent calls will get the data from the persistent storage
     * and returns. This allow to have client-side persistence of a result that is quickly available. The refreshed values
     * are stored in the persistent storage once the response return but won't be pushed to the user until the next call to the
     * save request.
     * When explicitly set to NULL, the request is not cached even if the option 'isCacheMandatoryIfEnabled' is set to true
     */
    persistentCache?: CacheConfiguration | null;
}
export interface ObjectRequestWithCache<TFetchValue> extends RequestWithCache {
    id: string;
    syntheticUrl: string;
    fetch: () => Promise<TFetchValue>;

}
export interface CachedData<T> {
    webFetchDateTimeMs: number;
    expirationDateTimeMs: number;
    payload: T;
}
export interface CacheDataWithId<T> extends CachedData<T> {
    id: string;
    url: string; // Only used to help debugging
}
export interface OnGoingAjaxRequest<T = any> {
    ajaxRequest: AjaxRequestInternal;
    promise: Promise<T>;
}

export interface PerformanceTimeMarker {
    startMs: number;
    stopMs?: number;
    elapsedMs?: number;
}
export interface PerformanceRequestInsight {
    fetch: PerformanceTimeMarker;
    memoryCache?: PerformanceTimeMarker;
    persistentStorageCache?: PerformanceTimeMarker;
    httpRequest?: PerformanceTimeMarker;
    dataSizeInBytes?: number;
}
export enum DataSource {
    HttpRequest = "HttpRequest",
    MemoryCache = "MemoryCache",
    PersistentStorageCache = "PersistentStorageCache",
    System = "System"
}
export enum DataAction {
    Save = "Save",
    Fetch = "Fetch",
    Use = "Use",
    Delete = "Delete",
    WaitingOnGoingRequest = "WaitingOnGoingRequest",
    AddFromOnGoingRequest = "AddFromOnGoingRequest",
    RemoveFromOnGoingRequest = "RemoveFromOnGoingRequest",
    System = "System"
}
export interface DataResponse<T extends object | string> {
    source: DataSource;
    result: T;
    webFetchDateTimeMs: number;
}

export interface DataDualResponse<T extends object | string> extends DataResponse<T> {
    webPromise: Promise<DataResponse<T>> | undefined; // Undefined if the expiration defined is not yet passed, undefined if the first response was the WEB
}

export interface LogBase {
    source: DataSource;
    action: DataAction;
    id: string;
    url: string;
    performanceInsight?: PerformanceRequestInsight;
    fetchType?: FetchType;
    httpMethod?: HttpMethod;
}
export interface LogError extends LogBase {
    kind: "LogError";
    error: any;
}
export interface LogInfo extends LogBase {
    kind: "LogInfo";
    dataSignature: string | undefined;
    dataAgeMs: number | undefined;
    /**
     * Only provided in the log when the DataAction is "Use" and a subsequent
     * promise will return another "Use" with fresh data. This should be used
     * at the moment only by the fetchFastAndFresh and allows to get better
     * telemetry when combined with dataAgeMs.
     */
    useIsIntermediate?: boolean | undefined;
}
