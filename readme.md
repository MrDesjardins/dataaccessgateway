# Data Access Gateway

The goal of this library is to provide a tiny abstraction to cache data from API calls easily without having to configure many options. It works with two levels of cache. The first one is a memory cache and the second use IndexDB as a persistent cache.

There is two modes. The first one is called `fetchFresh` and will check the memory cache first, if not present, will fall into the persistent cache. If not present or out-of-date, it does the HTTP request and fill the caches. In the case of obsolete data, the fallback to the API request might take times and hence this function doesn't guarantee to be efficient when the life of the data is out. The second mode, `fastFetch` will return the data from any cache (memory first, then persistent cache second) if available regardless of the expiration. However, it will fetch in background and fill the caches giving the opportunity to subsequent calls to have fresh values.

In both cases, there is also a simple mechanism to avoid querying the same on-going request. If for example a request is performing a long fetch and many same query are requested, the subsequent queries will wait the former request response. This avoid having many similar query in queue.

This library depends on Axios for HTTP Request and on Dexie for IndexDb.
# Example
## Simple
This is the most basic call. It uses many defaults. This will have a memory cache and persisted cache of 5 minutes and use the URL has unique key for every request. The unique key is used for two purposes. The first purpose is to make sure that only one unique query is executed at the same time and the second goal is to store the data in the cache.
```
// Normal Axios Request
const request: AxiosRequestConfig = { method: "GET", url: url};

// Execute the request through DataAccessGateway
const promiseResult = DataAccessGateway.fetchFast<YourEntityResponse>({request: request});
``` 
## Configuration by request
This example defines explicitly the requirement of having a memory cache of 1 minute and a persistent storage of 1 day. You can define per request the life span of the freshness of the data. After the threshold met, an Ajax call is made to get new data.
```
// Normal Axios Request
const request: AxiosRequestConfig = {
    method: "GET",
    url: url,
};

// Execute the request through DataAccessGateway
const promiseResult = DataAccessGateway.fetchFast<YourEntityResponse>({
                            memoryCache: { lifespanInSeconds: 60 },
                            persistentCache: { lifespanInSeconds: 60 * 60 * 24 },
                            request: request
                        });
``` 

## Custom key
It's possible to define custom key if the URL is not unique enough by adding an `id`.
``` 
 DataAccessGateway.fetchFast<YourEntityResponse>({
                            id: "myUniqueKey",
                            request: request
                        });
``` 

## Error insight
Most scenario will throw an error that can be caught by the promise. However, some deep case around IndexDb won't be returned because of the asynchronous operation that occur. However, you can add a log function that will be called in the option.
```
DataAccessGateway.setConfiguration({ log: (reason: any) => { Log.trackError(reason); } });
``` 

## Turning off the cache
It can be handy to turn off the caching capability and have a fall-through to always perform the Ajax request.
``` 
DataAccessGateway.setConfiguration({ isCacheEnabled: true });
``` 

## Default cache time
If you want to change the 5 minutes default for anything else you can do it with `setConfiguration`.
``` 
DataAccessGateway.setConfiguration({ defaultLifeSpanInSeconds: 120 });
``` 
