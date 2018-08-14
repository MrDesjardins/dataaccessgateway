import { AxiosRequestConfig } from "../node_modules/axios";
import { AjaxRequestInternal, AjaxRequestWithCache, FetchType, OnGoingAjaxRequest } from "../src/model";

export function getMockAxiosRequestConfig(): AxiosRequestConfig {
    return {
        url: "http://url"
    };
}
export function getMockAjaxRequest(id: string): AjaxRequestWithCache {
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
        httpMethod: undefined
    };
}

export function getMockOnGoingAjaxRequest(id: string, data: any): OnGoingAjaxRequest {
    return {
        ajaxRequest: getMockAjaxRequestWithId(id),
        promise: Promise.resolve(data)
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
            promise: new Promise(function(resolve, reject) {
                this.resolveNow = resolve;
                this.rejectNow = reject;
            }),
            resolveNow: () => {},
            rejectNow: () => {}
        };
    })();
}
