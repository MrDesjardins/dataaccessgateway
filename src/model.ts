import { AxiosRequestConfig } from "axios";

export enum FetchType {
    Fast = "Fast",
    Fresh = "Fresh",
    Web = "Web",
    Execute = "Execute"
}
export enum HttpMethod {
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
export interface AjaxRequest{
    /**
     * Identifier of the request. Need to be unique. If not provided, the hash of request is used
     */
    id?: string;
    request: AxiosRequestConfig;
}
export interface AjaxRequestWithCache extends AjaxRequest {

    /**
     * The memory cache configuration. It contains the lifespan before ejecting the data from the cache.
     * When not defined is set to X seconds (see constant in the class)
     */
    memoryCache?: CacheConfiguration;
    /**
     * When defined, the data is set into the persistent storage. Subsequent calls will get the data from the persistent storage
     * and returns. This allow to have client-side persistence of a result that is quickly available. The refreshed values
     * are stored in the persistent storage once the response return but won't be pushed to the user until the next call to the
     * save request.
     */
    persistentCache?: CacheConfiguration;
}

export interface AjaxRequestInternal extends AjaxRequestWithCache {
    id: string;
    fetchType: FetchType | undefined;
    httpMethod: HttpMethod;
}

export interface CachedData<T> {
    expirationDateTime: Date;
    payload: T;
}
export interface CacheDataWithId<T> extends CachedData<T> {
    id: string;
    url: string; // Only used to help debugging
}
export interface OnGoingAjaxRequest {
    ajaxRequest: AjaxRequestInternal;
    promise: Promise<any>;
}

export interface PerformanceTimeMarker {
    startMs: number;
    stopMs?: number;
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
export interface DataResponse<T> {
    source: DataSource;
    result: T;
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
}
