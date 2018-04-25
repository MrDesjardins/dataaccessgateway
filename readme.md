# dataaccessgateway

The goal of this library is to provide a way to cache data from API call easily without having to configure many options. It works with two levels of cache. The first one is a memory cache and the second use IndexDB as a persistent cache.

There is two modes. The first one is called `fetch` and will check the memory cache first, if not present, will fall into the persistent cache. If not present or out-of-date, it does the HTTP request and fill the caches. In the case of obsolete data, the fallback to the API request might take times and hence this function doesn't guarantee to be efficient when the life of the data is out. The second mode, `fastFetch` will return the data from any cache (memory first, then persistent cache second) if available regardless of the expiration. However, it will fetch in background and fill the caches giving the opportunity to subsequent calls to have fresh values.

In both cases, there is also a simple mechanism to avoid querying the same on-going request. If for example a request is performing a long fetch and many same query are requested, the subsequent queries will wait the former request response. This avoid having many similar query in queue.