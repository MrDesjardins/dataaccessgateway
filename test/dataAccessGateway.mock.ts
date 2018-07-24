import { AxiosRequestConfig } from "../node_modules/axios";
import { AjaxRequest, AjaxRequestWithId, OnGoingAjaxRequest } from "../src/model";

export function getMockAxiosRequestConfig(): AxiosRequestConfig {
    return {
        url: "http://url"
    };
}
export function getMockAjaxRequest(id: string): AjaxRequest {
    return {
        id: id,
        request: getMockAxiosRequestConfig()
    };
}

export function getMockAjaxRequestWithId(id: string): AjaxRequestWithId {
    return {
        id: id,
        request: getMockAxiosRequestConfig()
    };
}

export function getMockOnGoingAjaxRequest(id: string, data: any): OnGoingAjaxRequest {
    return {
        ajaxRequest: getMockAjaxRequest(id),
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
