import { AxiosRequestConfig } from "../node_modules/axios";
import { AjaxRequest, AjaxRequestExecute, AjaxRequestInternal, AjaxRequestWithCache, DataResponse, DataSource, FetchType, HttpMethod, OnGoingAjaxRequest } from "../src/model";

export function getMockAxiosRequestConfig(): AxiosRequestConfig {
    return {
        url: "http://url"
    };
}
export function getMockAjaxRequestWithCache(id: string): AjaxRequestWithCache {
    return {
        id: id,
        request: getMockAxiosRequestConfig()
    };
}

export function getMockAjaxRequestWithId(id: string): AjaxRequestInternal {
    return {
        id: id,
        fetchType: FetchType.Fast,
        request: getMockAxiosRequestConfig(),
        httpMethod: HttpMethod.GET
    };
}

export function getMockAjaxRequest(id: string): AjaxRequest {
    return {
        id: id,
        request: getMockAxiosRequestConfig()
    };
}

export function getMockAjaxRequestInternal(id: string): AjaxRequestInternal {
    return {
        id: id,
        fetchType: FetchType.Fast,
        request: getMockAxiosRequestConfig(),
        httpMethod: HttpMethod.GET
    };
}

export function getMockOnGoingAjaxRequest(id: string, data: any): OnGoingAjaxRequest {
    return {
        ajaxRequest: getMockAjaxRequestWithId(id),
        promise: Promise.resolve(data)
    };
}

export function getMockAjaxRequestExecute(id: string, requestsToInvalidate?: AjaxRequest[]): AjaxRequestExecute {
    return {
        id: id,
        request: getMockAxiosRequestConfig(),
        invalidateRequests: requestsToInvalidate
    };
}

export interface PromiseRetarder {
    promise: Promise<any>;
    resolveNow: () => void;
    rejectNow: () => void;
}

export function getPromiseRetarder(): PromiseRetarder {
    return (function() {
        return {
            promise: new Promise(function(this: any, resolve, reject) {
                this.resolveNow = resolve;
                this.rejectNow = reject;
            }),
            resolveNow: () => {},
            rejectNow: () => {}
        };
    })();
}

export function getDataResponse(payload: string): DataResponse<string> {
    return {
        result: payload,
        source: DataSource.HttpRequest,
        webFetchDateTimeMs: 1000
    };
}
