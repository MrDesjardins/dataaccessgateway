# Data Access Gateway

[![Build Status](https://travis-ci.org/MrDesjardins/dataaccessgateway.svg?branch=master&t=1)](https://travis-ci.org/MrDesjardins/dataaccessgateway)
[![Coverage Status](https://coveralls.io/repos/github/MrDesjardins/dataaccessgateway/badge.svg?branch=master)](https://coveralls.io/github/MrDesjardins/dataaccessgateway?branch=master&t=1)
[![npm version](https://badge.fury.io/js/dataaccessgateway.svg?t=1)](https://badge.fury.io/js/dataaccessgateway)

## Goal

The goal of the Data Access Library (DAG) is to provide a tiny abstraction to cache data when performing remote HTTP(s) API requests. DAG eases manipulating request by caching the data in memory and/or in the browser persistent memory with a limited set of options. The cache works with two levels of cache: the first one is a memory cache and the second use IndexDB as a persistent cache.

## Why?

-   Improve your performance by reducing waiting moment with quick memory cache response
-   Remove simultaneous identical HTTP requests
-   Reduce loading time of your single-page application by loading previous data from the browser's Index DB while refreshing from the server
-   Reduce the bandwidth of your application by reducing data movement between the client and server side
-   Craft your request with Axios' request object, therefore nothing new to learn
-   Leverage Axios and Dexie libraries
-   Small footprint
-   Automatically invalidates cache on data execution

# Summary of the functions

There is few functions to fetch data and a single one to execute a request to save data.

## Fetch Fast

### What

The first function, `fetchFast` returns the data from any cache (memory first, then persistent cache second) if available regardless of the expiration. However, it will fetch in the background and fills the caches giving the opportunity to subsequent calls to have fresh values.

### When

Use this function if you want a very fast response when displaying an older value for few requests is not critical. On a system where the user invoke this function often, it is the best experience since the possibility to stay woth obselete value are limited. The `fetchFast` is great use for system using _Redux_ where many action might call rapidly the same fetching function. The first call might get expired data to display, but the query will be run and the cache will get updated. A next actions may get the data, again from the cache, but this time with the fresh data.

### Graph

Here is the flow from the actor request call up to when the data is coming back.

![alt text](https://github.com/MrDesjardins/dataaccessgateway/raw/master/images/fastFetchFlowDiagram.png "Fast Fetch Flow Diagram")

### Examples

#### Simple

This is the most basic call. It uses many defaults. This will have a memory cache and persisted cache of 5 minutes and use the URL has unique key for every request. The unique key is used for two purposes. The first purpose is to make sure that only one unique query is executed at the same time and the second goal is to store the data in the cache.

```
// Normal Axios Request
const request: AxiosRequestConfig = { method: "GET", url: url};

// Execute the request through DataAccessGateway
const promiseResult = DataAccessGateway("AppName").fetchFast<YourEntityResponse>({request: request});
```

#### Configuration by request

This example defines explicitly the requirement of having a memory cache of 1 minute and a persistent storage of 1 day. You can define per request the life span of the freshness of the data. After the threshold met, an Ajax call is made to get new data.

```
// Normal Axios Request
const request: AxiosRequestConfig = {
    method: "GET",
    url: url,
};

// Execute the request through DataAccessGateway
const promiseResult = DataAccessGateway("AppName").fetchFast<YourEntityResponse>({
                            memoryCache: { lifespanInSeconds: 60 },
                            persistentCache: { lifespanInSeconds: 60 * 60 * 24 },
                            request: request
                        });
```

#### Custom key

It is possible to define a custom key if the URL is not unique enough by adding an `id`. The custom key is required when fetching with a same URL different data. That can happen when using POST to fetch data. By default, the library hashes the URL, urlBase, Params data and the method to generate unique identifier. The custom key gives you the flexibility to manually craft a unique key allowing the same URL to cache and to handle on-going Ajax call uniquely.

```
 DataAccessGateway("AppName").fetchFast<YourEntityResponse>({
                            id: "myUniqueKey",
                            request: request
                        });
```

## Fetch Fresh

### What

The `fetchFresh` is the traditional caching function that checks the memory cache first. If the data is not present, it will fall into the persistent cache. If the request is not present in the persistent cache or out-of-date, it does the HTTP request and fill the caches. At every level of cache, if data is obsolete it does the API request. Doing the HTTP call will take times and hence this function does not guarantee to be efficient when the life of the data is out.

### When

Use this function when you want to ensure that the lifespan of the data is respected. The lifespan can be a general value, or by type of cache (memory and persistence) or can be by request. The `fetchFresh` is useful in scenario where old data is not acceptable.

### Graph

Here is the flow from the actor request call up to when the data is coming back.

![alt text](https://github.com/MrDesjardins/dataaccessgateway/raw/master/images/freshFetchFlowDiagram.png "Fresh Fetch Flow Diagram")

### Examples

```
const request: AxiosRequestConfig = { method: "GET", url: url};
const promiseResult = DataAccessGateway("AppName").fetchFresh<YourEntityResponse>({request: request});
```

## Fetch Web

### What

The fetch web is a side function that allows to always returns the response from the web. It skips the cache on read. However, it still stores the HTTP response into the caches. It allows to be 100% to get the result from the web while allowing other calls that leverage the cache to use the response. It also benefits of the on-going request feature which avoid multiple identical request to be performed at the same time reducing duplicate request. The function is connected to the `logInfo` allowing to keep track of the source of the information.

### When

Use this function when a part of your application must have the data from the server but other piece of the software does not. When calling the `fetchWeb` you always get the data from the server, and other part of the system that use `fetchFast` or `fetchFresh` can leverage the response from `fetchWeb`.

### Graph

Here is the flow for `fetchWeb`.

![alt text](https://github.com/MrDesjardins/dataaccessgateway/raw/master/images/fetchWebFlowDiagram.png "Fetch Web Flow Diagram")

## Fetch FastAndFresh

### What

The function, `fetchFastAndFresh` returns the data from any cache (memory first, then persistent cache second) if available regardless of the expiration. However, it will fetch in the background and fills the caches giving the opportunity to subsequent calls to have fresh values. So far, it is the same as `fetchFast`. However, the major difference is that `fetchFastAndFresh` returns a `DataDualResponse` which has a `Promise<T>` of the web request. The goal of this function is to render a first time very quickly (from the cache) and to expect to receive second callback (from the promise in the response) to render a second time accurately with fresh data.

### When

Use this function if you want a very fast response when displaying but that a fresh version is required. See this as a better "spinner experience". For exemple, you may display in a dashboard obsolete information for few milliseconds instead of a spinner by using the result from the return value of `fetchFastAndFresh` and to use the result's promise to refresh the dashboard with more recent data.

### Graph

Here is the flow from the actor request call up to when the data is coming back.

![alt text](https://github.com/MrDesjardins/dataaccessgateway/raw/master/images/fastAndFreshFlowDiagram.png "Fast and Fresh Flow Diagram")

### Examples

#### Simple

This is the most basic call. It uses many defaults. This will have a memory cache and persisted cache of 5 minutes and use the URL has unique key for every request. The unique key is used for two purposes. The first purpose is to make sure that only one unique query is executed at the same time and the second goal is to store the data in the cache.

```
// Normal Axios Request
const request: AxiosRequestConfig = { method: "GET", url: url};

// Execute the request through DataAccessGateway
const response = await DataAccessGateway("AppName").fastAndFresh<YourEntityResponse>({request: request});

// Render the user interface with response.result here

// Subscribe to the promise of the response to update with fresh data later
const webPromise = response.webPromise;
if(webPromise !== undefined){
    responseWeb = await webPromise; // It's defined, thus we will get new data
    // Render the user interface a second time with responseWeb by using responseWeb.result
}
```

## FetchFastAndFreshObject

### What

The `FetchFastAndFreshObject` is a way to have fetching performing by another mechanism than Ajax. For example, you may have a **GraphQL** fetching using a third-party library and still would like to use the DAG library. Because the `fetchFastAndFresh` is the most flexible of the fetch, `FetchFastAndFreshObject` is the only one implemented, as today for object.

The principle is that instead of performing a HTTP get method to fetch the data that a function from your request is called. In that function, you need to return the object that the DAG needs (or not) to cache depending of the standar caching mechanism of the DAG.

### When

1- Does not need to do an AJAX call
2- Does want to store directly an object in the cache
3- Use of GraphQL library in concert of conventional Ajax calls.

### Graph

Here is the flow from the actor request call up to when the data is coming back.

![alt text](https://github.com/MrDesjardins/dataaccessgateway/raw/master/images/fetchFastAndFreshObject.png "Fast and Fresh Flow Diagram")

### Examples

#### GraphQL

Here is an example with GraphQL using the Apollo-Client

```
const fetchingId = hash(graphQLQuery) + hash(graphQLParams);
const generatedUrl = graphQLQuery;

const reponse = await DataAccessGateway("AppName").fetchFastAndFreshObject({
                id: fetchingId, /* Unique id to be able to cache */
                syntheticUrl: generatedUrl,  /* An object does not have an "URL" but we use the same system for log, etc*/
                fetch: async () => { /* If the ID is not fresh in the cache, it will execute this function */
                    const value: ApolloQueryResult<QueryTypeHere> = await this.client.query<QueryTypeHere>({
                        query: graphqlQuery,
                        variables: { x: 123 }
                    });
                    return value; /* This value is cached, but also returned by the fetchFastAndFreshObject*/
                }
});

// Render the user interface with response.result here

// Subscribe to the promise of the response to update with fresh data later (from the `fetch` function)
const webPromise = response.webPromise;
if(webPromise !== undefined){
    responseWeb = await webPromise; // It's defined, thus we will get new data
    // Render the user interface a second time with responseWeb by using responseWeb.result
}
```

## Execute

### What

The `execute` function allows doing a direct Ajax call. Ideal for POST, PUT and DELETE ajax call. Executing a request through the `execute` function does not interfere with the cache. Neither before or after with the response. The library takes care of on-going request to avoid similar parallel queries at the same time and allows to have the log tools.

A last feature of execute is that the parameter of the function can take a reference to other request that need to be removed from all caches.

### When

Anytime you need to do a HTTP POST, PUT and DELETE. Anytime you want to invalidate automatically request done by `fetchFast`, `fetchFresh` or `fetchWeb` without having to manually invalidate the cache in your application.

### Examples

### Execute POST and invalidate a GET request

Example that execute a request and invalidate automatically the cache of an other request

```
// GET request
export function getEntityRequest(id:number): AjaxRequest {
    let requestConfig: AxiosRequestConfig = {
        method: "GET",
        url: `/api/entityName/${entity.id}`
    };
    return {
        request: requestConfig
    };
}

// POST request
export function getPostEntityRequest(entity: YourEntity): AjaxRequestExecute {
    let requestConfig: AxiosRequestConfig = {
        method: "POST",
        url: `/api/entityName/${entity.id}`,
        data: entity
    };
    return {
        request: requestConfig,
        invalidateRequests: [getEntityRequest(entity.id)]
    };
}

// This will execute the POST, once the data is back from the backend will invalidate
// the cache provided in the the invalidateRequests
DataAccessGateway("AppName").execute(getPostEntityRequest({id:1}));
```

Is is possible to not only invalidate but to force the library to fetch the invalidated request back. Forcing to delete and fetching will do more HTTP call but can be a good way to keep the cache warm with a fresh copy of data righ away. The `AjaxRequestExecute` has an optional parameter `forceInvalidateAndRefresh` that will delete from the cache and execute the HTTP request that will set back the value in the cache in respect of the requests' configuration.

```
// POST request
export function getPostEntityRequest(entity: YourEntity): AjaxRequestExecute {
    let requestConfig: AxiosRequestConfig = {
        method: "POST",
        url: `/api/entityName/${entity.id}`,
        data: entity
    };
    return {
        request: requestConfig,
        invalidateRequests: [getEntityRequest(entity.id)],
        forceInvalidateAndRefresh: true // <-- Will refresh the data by executing the request of getEntityRequest(entity.id)
    };
}
```

## ForceDeleteAndFetch

### What

Once in a while, it is required to delete from the cache regardless of the remaining expiration set. The function `forceDeleteAndFetch` allows to delete from all caches (memory and persistence) and then fetch again in the background without having to worry about the response. The goal is to flush the caches and have a fresh version of the information in the caches once the data is back.

### When

A scenario when it can be useful is when a user saves new data in the backend by using the `execute` function. The cache will have wrong data. In some scenario, it is hard to invalidate by providing the fetch request at the `execute` function option.

### Example

```
// GET request
export function getEntityRequest(id:number): AjaxRequest {
    let requestConfig: AxiosRequestConfig = {
        method: "GET",
        url: `/api/entityName/${entity.id}`
    };
    return {
        request: requestConfig
    };
}
DataAccessGateway("AppName").forceDeleteAndFetch(getEntityRequest(1));
```

## DeleteDataFromCache

### What

Delete the data from both caches: memory and persisted storage.

### When

When you need to clean up data without fetching them right away. Can be useful when you need to clean up because a user does not have access to some data after a specific action.

### Example

```
// GET request
export function getEntityRequest(id:number): AjaxRequest {
    let requestConfig: AxiosRequestConfig = {
        method: "GET",
        url: `/api/entityName/${entity.id}`
    };
    return {
        request: requestConfig
    };
}
DataAccessGateway("AppName").deleteDataFromCache(getEntityRequest(1));
```

## DeletePersistentStorage

### What

Nuke completely the persistent storage

### When

If you change your model structure, you may want to flush everything and start from strach.

### Example

```
DataAccessGateway("AppName").deletePersistentStorage("AppName");
```

## DeleteAllDataFromAllCache

### What

Clear all data in the memory cache and clear all the persisten storage (without deleting the IndexDb)

### When

If you want to have a button allowing your users to manually flush the cache. Often, a button in deep in the user's preference is suggested when debugging your application. It is easier to tell a user to flush the cache then doing multiple steps. Flushing the cache is always a good
step when debugging inconsistent data.

### Example

```
DataAccessGateway("AppName").deleteAllDataFromAllCache();
```

# On-going HTTP Request

In all cases, there is also a simple mechanism to avoid querying the same on-going request. If for example a request is performing a long fetch and many same query are requested, the subsequent queries will wait the former request response. This avoid having many similar query in queue.

# Dependencies

This library depends on Axios for HTTP Request and on Dexie for IndexDb.

# Error insight

Most scenario will throw an error that can be caught by the promise. However, some deep case around IndexDb won't be returned because of the asynchronous operation that occur. However, you can add a log function that will be called in the option.

```
DataAccessGateway("AppName").setConfiguration({ log: (reason: any) => { Log.trackError(reason); } });
```

# Turning off the cache in general (for all requests)

It can be handy to turn off the caching capability and have a fall-through to always perform the Ajax request.

```
DataAccessGateway("AppName").setConfiguration({ isCacheEnabled: true });
```

# Turning off the cache for a specific request

You may have set to have the cache enabled but for some requests wish to not use a specic kind of cache. A scenario could be that you need to cache an object which is not supported by the memory cache (because of the serialization). In that case, you may want to skip for these particular cases the memory cache and still be able to rely on the persistent cache (taht support object). The setting is on the request. Instead of setting a memory configuration, you can set `null`. It is important to notice that `undefined` would set the setting with the default general cache and `null` specify to not fallback to the default cache setting. `null` is the value you want to use in that particular case.

```
// Example that will only rely on the persistent cache
const promiseResult = DataAccessGateway("AppName").fetchFast<YourEntityResponse>({
                            memoryCache: null,
                            persistentCache: { lifespanInSeconds: 60 * 60 * 24 },
                            request: request
                        });
```

# Default cache time

If you want to change the `5 minutes` default for anything else you can do it with `setConfiguration`.

```
DataAccessGateway("AppName").setConfiguration({ defaultLifeSpanInSeconds: 120 });
```

# Signature

It is possible to turn on the creation of payload signature. This is an experimental feature. It works in collaboration with the Chrome's extension which allow to turn to on the signature creation. Once it is done, the gateway library will generate a hash and share the hash with the data payload to the Chrome Extension. It should never been used in production because it has a huge impact in performance. The goal is to capture a unique signature on every payload to compare of something changed. The Chrome's extension can gather difference and give insight about the timing of specific endpoint change. To use the feature:

```
DataAccessGateway("AppName")..setConfiguration({
    alterObjectBeforeHashing: (obj: any) => {
        const clone = { ...obj };
        removeProperty(clone, "lastGenerated");
        return clone;
    }
});
```

The code example has a `alterObjectBeforeHashing` give a change to alter the object before being hashed. The function is useful if you need to remove something that change all the time to an object or to remove a branch that can be time consuming to hash. A normal use case is to remove a property that is changing all the time from the API like the last time generated time the data was built by the API which could be different on every call.

# Chrome Extension

There is an [open-source Chrome extension](https://github.com/MrDesjardins/dataaccessgatewaychromeextension) that allows to get insight from the library.
