import { AxiosResponse } from "../node_modules/axios";
import { DataAccessIndexDbDatabase, DataAccessSingleton, DeleteCacheOptions } from "../src/dataAccessGateway";
import { AjaxRequest, CacheConfiguration, CachedData, DataResponse, DataSource } from "../src/model";
const DATABASE_NAME = "Test";
interface FakeObject {
    id: string;
    name: string;
}
const cacheDataExpired: CachedData<string> = {
    expirationDateTime: new Date((new Date()).getTime() - 10000),
    payload: "Test"
};
const cacheDataNotExpired: CachedData<string> = {
    expirationDateTime: new Date((new Date()).getTime() + 10000),
    payload: "Test"
};
const dataResponseFromCache: DataResponse<string> = {
    result: "Test",
    source: DataSource.HttpRequest
};
describe("DataAccessIndexDbDatabase", () => {
    let didb: DataAccessIndexDbDatabase;
    beforeEach(() => {
        didb = new DataAccessIndexDbDatabase("");
    });
    describe("dropTable", () => {
        describe("when data is definFed", () => {
            beforeEach(() => {
                didb.data = { clear: () => { } } as any;
                (didb as any).data.clear = jest.fn();
            });
            it("clears data", async () => {
                expect.assertions(1);
                await didb.dropTable();
                expect(didb.data.clear as any).toHaveBeenCalledTimes(1);
            });
        });
        describe("when data is undefined", () => {
            beforeEach(() => {
                didb.data = undefined;
            });
            it("rejects the promise", async () => {
                expect.assertions(1);
                didb.dropTable().catch(e => expect(e).toBeDefined());
            });
        });
    });
});
describe("DataAccessSingleton", () => {
    let das: DataAccessSingleton;
    let request: AjaxRequest;
    let ajaxResponse: AxiosResponse<string>;

    beforeEach(() => {
        das = new DataAccessSingleton(DATABASE_NAME);
        das.addInPersistentStore = jest.fn().mockRejectedValue("test");
        das.getPersistentStoreData = jest.fn().mockRejectedValue("test");
        das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
        request = {
            request: {
                url: "http://request"
            }
        };
        ajaxResponse = {
            status: 500,
            data: "payload",
            statusText: "Good",
            config: {},
            headers: {}
        };
    });
    describe("getInstance", () => {
        describe("when called twice with the same name", () => {
            it("returns the same instance", () => {
                const instance1 = DataAccessSingleton.getInstance("test");
                const instance2 = DataAccessSingleton.getInstance("test");
                expect(instance1).toBe(instance2);
            });
        });
        describe("when called twice with the same name", () => {
            it("returns the same instance", () => { // This is until we support many instances
                const instance1 = DataAccessSingleton.getInstance("1");
                const instance2 = DataAccessSingleton.getInstance("2");
                expect(instance1).toBe(instance2);
            });
        });
    });
    describe("setConfiguration", () => {
        describe("empty options", () => {
            it("uses default option", () => {
                das.setConfiguration();
                expect(das.options).toBe(das.DefaultOptions);
            });
        });
        describe("partial options", () => {
            it("uses default value for unspecified options", () => {
                das.setConfiguration({ isCacheEnabled: false });
                expect(das.options.defaultLifeSpanInSeconds).toBe(das.DefaultOptions.defaultLifeSpanInSeconds);
            });
        });
    });

    describe("setDefaultRequestId", () => {
        let request: AjaxRequest;
        beforeEach(() => {
            request = {
                request: {
                    url: "http://request"
                }
            };
        });
        describe("when has an id ", () => {
            beforeEach(() => {
                request = {
                    id: "MyId",
                    request: {
                        url: "http://request"
                    }
                };
            });
            it("keeps the id", () => {
                das.setDefaultRequestId(request);
                expect(request.id).toBe("MyId");
            });
        });
        describe("when does NOT have an id ", () => {
            beforeEach(() => {
                request = {
                    id: undefined,
                    request: {
                        url: "http://request"
                    }
                };
            });
            describe("and request URL is undefined ", () => {
                beforeEach(() => {
                    request.request.url = undefined;
                });
                it("sets an empty id", () => {
                    das.setDefaultRequestId(request);
                    expect(request.id).toBe("");
                });
            });
            describe("and request URL is NOT undefined ", () => {
                beforeEach(() => {
                    request.request.url = "http://test.com";
                });
                it("uses the URL has the id", () => {
                    das.setDefaultRequestId(request);
                    expect(request.id).toBe("http://test.com");
                });
            });
        });
    });

    describe("setDefaultCache", () => {
        beforeEach(() => {
            request = {
                request: {
                }
            };
        });
        describe("when NO memory cache defined", () => {
            beforeEach(() => {
                request.memoryCache = undefined;
            });
            describe("when cache mandatory", () => {
                beforeEach(() => {
                    das.options.isCacheMandatoryIfEnabled = true;
                });
                it("sets the default cache", () => {
                    das.setDefaultCache(request);
                    expect(request.memoryCache).toBeDefined();
                });
            });
            describe("when cache NOT mandatory", () => {
                beforeEach(() => {
                    das.options.isCacheMandatoryIfEnabled = false;
                });
                it("does NOT sets the default cache", () => {
                    das.setDefaultCache(request);
                    expect(request.memoryCache).toBeUndefined();
                });
            });
            describe("when memory cache defined", () => {
                let memoryCache: CacheConfiguration;
                beforeEach(() => {
                    memoryCache = { lifespanInSeconds: 9876 };
                    request.memoryCache = memoryCache;
                });
                it("does NOT sets the default cache", () => {
                    das.setDefaultCache(request);
                    expect(request.memoryCache).toBe(memoryCache);
                });
            });
        });
    });

    describe("setDefaultFastCache", () => {
        beforeEach(() => {
            request = {
                request: {
                }
            };
        });
        describe("when NO persistent cache defined", () => {
            beforeEach(() => {
                request.persistentCache = undefined;
            });
            describe("when cache mandatory", () => {
                beforeEach(() => {
                    das.options.isCacheMandatoryIfEnabled = true;
                });
                it("sets the default cache", () => {
                    das.setDefaultFastCache(request);
                    expect(request.persistentCache).toBeDefined();
                });
            });
            describe("when cache NOT mandatory", () => {
                beforeEach(() => {
                    das.options.isCacheMandatoryIfEnabled = false;
                });
                it("does NOT sets the default cache", () => {
                    das.setDefaultFastCache(request);
                    expect(request.persistentCache).toBeUndefined();
                });
            });
            describe("when persistent cache defined", () => {
                let fastCache: CacheConfiguration;
                beforeEach(() => {
                    fastCache = { lifespanInSeconds: 9876 };
                    request.persistentCache = fastCache;
                });
                it("does NOT sets the default cache", () => {
                    das.setDefaultFastCache(request);
                    expect(request.persistentCache).toBe(fastCache);
                });
            });
        });
    });

    describe("fetchFast", () => {
        let request: AjaxRequest;
        beforeEach(() => {
            request = {
                request: {
                    url: "http://request"
                }
            };
        });
        describe("when cache disabled", () => {
            beforeEach(() => {
                das.setConfiguration({ isCacheEnabled: false });
                das.fetchAndSaveInCacheIfExpired = jest.fn().mockResolvedValue(undefined);
                das.getMemoryStoreData = jest.fn();
                das.getPersistentStoreData = jest.fn();
            });
            it("invokes the HTTP fetch functions", () => {
                das.fetchFast(request);
                expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
            });
            it("does not invoke Memory cache", () => {
                das.fetchFast(request);
                expect(das.getMemoryStoreData).toHaveBeenCalledTimes(0);
            });
            it("does not invoke Persistent cache", () => {
                das.fetchFast(request);
                expect(das.getPersistentStoreData).toHaveBeenCalledTimes(0);
            });
        });
        describe("when cache enabled", () => {
            beforeEach(() => {
                das.setConfiguration({ isCacheEnabled: true });
                das.setDefaultRequestId = jest.fn();
                das.setDefaultFastCache = jest.fn();
                das.fetchAndSaveInCacheIfExpired = jest.fn();
            });
            it("always set default request id", () => {
                das.fetchFast(request);
                expect(das.setDefaultRequestId).toHaveBeenCalledTimes(1);
            });
            it("always set default fast cache option", () => {
                das.fetchFast(request);
                expect(das.setDefaultFastCache).toHaveBeenCalledTimes(1);
            });
            describe("when cache enabled", () => {
                beforeEach(() => {
                    das.setConfiguration({ isCacheEnabled: true });
                });
                describe("when data in memory cache", () => {
                    beforeEach(() => {
                        das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataNotExpired);
                        das.getPersistentStoreData = jest.fn();
                    });
                    it("tries to fetch from memory cache before persistence", () => {
                        das.fetchFast(request);
                        expect(das.getMemoryStoreData).toHaveBeenCalledTimes(1);
                        expect(das.getPersistentStoreData).toHaveBeenCalledTimes(0);
                    });
                    describe("when data in memory cache has expired", () => {
                        beforeEach(() => {
                            das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataExpired);
                        });
                        it("returns the data found in cache", () => {
                            das.fetchFast(request);
                            expect(das.getMemoryStoreData).toHaveBeenCalledTimes(1);
                        });
                        it("invokes fetch", () => {
                            das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
                        });
                        it("returns the expired data from the Memory cache", async () => {
                            const result = await das.fetchFast(request);
                            expect(result).toEqual({ result: "Test", source: DataSource.MemoryCache });
                        });
                    });
                    describe("when data in memory cache has NOT expired", () => {
                        beforeEach(() => {
                            das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataNotExpired);
                        });
                        it("invokes fetch (but won't fetch)", () => {
                            das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
                        });
                    });
                });
                describe("when NO data in memory cache ", () => {
                    beforeEach(() => {
                        das.getMemoryStoreData = jest.fn().mockReturnValue(undefined);
                        das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataExpired);
                    });
                    it("call the persistent cache", () => {
                        das.fetchFast(request);
                        expect(das.getPersistentStoreData).toHaveBeenCalledTimes(1);
                    });
                    describe("when data in persistent cache has expired", () => {
                        beforeEach(() => {
                            das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataExpired);
                        });
                        it("invokes fetch", async () => {
                            await das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
                        });
                        it("returns the expired data from the Memory cache", async () => {
                            const result = await das.fetchFast(request);
                            expect(result).toEqual({ result: "Test", source: DataSource.PersistentStorageCache });
                        });
                    });
                    describe("when data in persistent cache has NOT expired", () => {
                        beforeEach(() => {
                            das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataNotExpired);
                            das.addInMemoryCache = jest.fn();
                        });
                        it("invokes fetch (but won't fetch)", async () => {
                            await das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
                        });
                        describe("when memory cache enabled", () => {
                            beforeEach(() => {
                                request.memoryCache = { lifespanInSeconds: 120 };
                            });
                            it("adds in memory", async () => {
                                await das.fetchFast(request);
                                expect(das.addInMemoryCache).toHaveBeenCalledTimes(1);
                            });
                        });
                    });
                    describe("when NO data in persistence cache ", () => {
                        beforeEach(() => {
                            das.getPersistentStoreData = jest.fn().mockResolvedValue(undefined);
                        });
                        it("invokes fetch", async () => {
                            await das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
                        });
                    });
                });

                describe("when HTTP status 500 followed by a second same call", () => {
                    beforeEach(() => {
                        das.getMemoryStoreData = jest.fn().mockReturnValue(undefined);
                        das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataExpired);
                        das.saveCache = jest.fn();
                    });
                    it("calls the Ajax the second call (like the first one)", async () => {
                        await das.fetchFast(request);
                        await das.fetchFast(request);
                        expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(2);
                    });
                    it("NEVER save in cache", async () => {
                        await das.fetchFast(request);
                        await das.fetchFast(request);
                        expect(das.saveCache).toHaveBeenCalledTimes(0);
                    });
                });
            });
        });
    });
    describe("fetchAndSaveInCacheIfExpired", () => {
        let source: DataSource;
        let cacheEntry: CachedData<string> | undefined;
        beforeEach(() => {
            das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
            das.saveCache = jest.fn();
        });
        describe("when cacheEntry is undefined", () => {
            beforeEach(() => {
                cacheEntry = undefined;
            });
            it("fetches with an AJAX call the data remotely", async () => {
                try {
                    await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                } catch (e) {

                }
                expect(das.saveCache).toHaveBeenCalledTimes(0);
            });
            describe("when status code is 200", () => {
                beforeEach(() => {
                    ajaxResponse.status = 200;
                    das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
                });

                it("saves the fetched result in the cache", async () => {
                    await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                    expect(das.saveCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when status code is 500", () => {
                beforeEach(() => {
                    ajaxResponse.status = 500;
                });
                it("does not save in cache", async () => {
                    try {
                        await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                    } catch (e) {
                        expect(e).toBeDefined();
                    }
                    expect(das.saveCache).toHaveBeenCalledTimes(0);
                });
            });
        });
        describe("when data has expired", () => {
            beforeEach(() => {
                cacheEntry = cacheDataExpired;
            });
            it("fetches with an AJAX call the data remotely", async () => {
                try {
                    await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                } catch (e) {

                }
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(1);
            });
            describe("when status code is 200", () => {
                beforeEach(() => {
                    ajaxResponse.status = 200;
                });
                it("saves the fetched result in the cache", async () => {
                    await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                    expect(das.saveCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when status code is 500", () => {
                beforeEach(() => {
                    ajaxResponse.status = 500;
                });
                it("does not save in cache", async () => {
                    try {
                        await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                    } catch (e) {
                        expect(e).toBeDefined();
                    }
                    expect(das.saveCache).toHaveBeenCalledTimes(0);
                });
            });
        });

        describe("when cacheEntry is defined and not expired", () => {
            beforeEach(() => {
                cacheEntry = cacheDataNotExpired;
                das.saveCache = jest.fn();
            });
            it("does not call the Ajax method to fetch", async () => {
                await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(0);
            });
            it("returns the payload of the original data", async () => {
                const result = await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(result.result).toEqual(cacheDataNotExpired.payload);
            });
            it("returns the original source", async () => {
                const result = await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(result.source).toEqual(source);
            });
        });
    });
    describe("saveCache", () => {
        let response: DataResponse<string>;
        beforeEach(() => {
            response = {
                result: "Test",
                source: DataSource.HttpRequest
            };
            das.addInMemoryCache = jest.fn();
            das.addInPersistentStore = jest.fn().mockResolvedValue("test");
        });
        describe("when memory cache is undefined", () => {
            beforeEach(() => {
                request.memoryCache = undefined;
            });
            it("does NOT add in the memory cache", async () => {
                await das.saveCache(request, response);
                expect(das.addInMemoryCache).toHaveBeenCalledTimes(0);
            });
        });
        describe("when memory cache is defined", () => {
            beforeEach(() => {
                request.memoryCache = {
                    lifespanInSeconds: 120
                };
            });
            it("adds in the memory cache", async () => {
                await das.saveCache(request, response);
                expect(das.addInMemoryCache).toHaveBeenCalledTimes(1);
            });
        });
        describe("when persistent cache is undefined", () => {
            beforeEach(() => {
                request.persistentCache = undefined;
            });
            it("does NOT add in the persistent cache", async () => {
                await das.saveCache(request, response);
                expect(das.addInPersistentStore).toHaveBeenCalledTimes(0);
            });
        });
        describe("when persistent cache is defined", () => {
            beforeEach(() => {
                request.persistentCache = {
                    lifespanInSeconds: 120
                };
            });
            it("adds in the persistent cache", async () => {
                await das.saveCache(request, response);
                expect(das.addInPersistentStore).toHaveBeenCalledTimes(1);
            });
        });
        it("returns the response from the parameter", async () => {
            const result = await das.saveCache(request, response);
            expect(result).toBe(response);
        });
    });

    describe("fetchFresh", () => {
        let request: AjaxRequest;
        beforeEach(() => {
            request = {
                request: {
                    url: "http://request"
                }
            };
            das.setConfiguration({ isCacheEnabled: true });
            das.setDefaultRequestId = jest.fn();
            das.setDefaultCache = jest.fn();
            das.fetchAndSaveInCacheIfExpired = jest.fn();
            das.tryMemoryCacheFetching = jest.fn().mockRejectedValue("test");
            das.tryPersistentStorageFetching = jest.fn().mockRejectedValue("test");
            das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
            das.saveCache = jest.fn().mockResolvedValue(cacheDataNotExpired);
        });
        it("always call the default request id configuration", () => {
            das.fetchFresh(request);
            expect(das.setDefaultRequestId).toHaveBeenCalledTimes(1);
        });
        it("always call the default cache", () => {
            das.fetchFresh(request);
            expect(das.setDefaultCache).toHaveBeenCalledTimes(1);
        });
        it("always call memory cache", () => {
            das.fetchFresh(request);
            expect(das.tryMemoryCacheFetching).toHaveBeenCalledTimes(1);
        });
        describe("when value is in memory cache", () => {
            beforeEach(() => {
                das.tryMemoryCacheFetching = jest.fn().mockResolvedValue(dataResponseFromCache);
                das.saveCache = jest.fn().mockResolvedValue(dataResponseFromCache);
            });
            it("returns memory cache", async () => {
                const result = await das.fetchFresh(request);
                expect(result.result).toEqual(cacheDataNotExpired.payload);
            });
            it("always invoke saveCache", async () => {
                await das.fetchFresh(request);
                expect(das.saveCache).toHaveBeenCalledTimes(1);
            });
        });
        describe("when value is NOT in memory cache", () => {
            beforeEach(() => {
                das.tryMemoryCacheFetching = jest.fn().mockResolvedValue(undefined);
                das.tryPersistentStorageFetching = jest.fn().mockResolvedValue(undefined);
            });
            it("returns call persistent storage", async () => {
                await das.fetchFresh(request);
                expect(das.tryPersistentStorageFetching).toHaveBeenCalledTimes(1);
            });
            describe("when value is NOT in persistent cache", () => {
                beforeEach(() => {
                    das.tryPersistentStorageFetching = jest.fn().mockResolvedValue(undefined);
                });
                it("calls Ajax HTTP request", async () => {
                    await das.fetchFresh(request);
                    expect(das.fetchWithAjax).toHaveBeenCalledTimes(1);
                });
            });
            describe("when value is in persistent cache", () => {
                beforeEach(() => {
                    das.tryPersistentStorageFetching = jest.fn().mockResolvedValue(dataResponseFromCache);
                });
                it("calls save cache", async () => {
                    await das.fetchFresh(request);
                    expect(das.saveCache).toHaveBeenCalledTimes(1);
                });
            });
        });
    });
    describe("tryMemoryCacheFetching", () => {
        beforeEach(() => {
            request.memoryCache = {
                lifespanInSeconds: 120
            };
        });
        describe("when cache configuration is undefined", () => {
            beforeEach(() => {
                request.memoryCache = undefined;
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(request);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache disabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = false;
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(request);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache enabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = true;
            });
            describe("when memory cache has an expired data", () => {
                beforeEach(() => {
                    das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataExpired);
                    das.deleteFromMemoryCache = jest.fn();
                });
                it("deletes the data from the cache", async () => {
                    await das.tryMemoryCacheFetching(request);
                    expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when memory cache has a fresh data", () => {
                beforeEach(() => {
                    das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataNotExpired);
                    das.deleteFromMemoryCache = jest.fn();
                });
                it("returns the data with memory cache source", async () => {
                    const result = await das.tryMemoryCacheFetching(request);
                    expect(result.source).toBe(DataSource.MemoryCache);
                });
            });
        });
        describe("when doesn't have the data", () => {
            beforeEach(() => {
                das.getMemoryStoreData = jest.fn().mockReturnValue(undefined);
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(request);
                expect(result).toBeUndefined();
            });
        });
    });
    describe("tryPersistentStorageFetching", () => {
        beforeEach(() => {
            request.persistentCache = {
                lifespanInSeconds: 120
            };
        });
        describe("when cache configuration is undefined", () => {
            beforeEach(() => {
                request.persistentCache = undefined;
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(request);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache disabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = false;
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(request);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache enabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = true;
            });
            describe("when persistent cache has an expired data", () => {
                beforeEach(() => {
                    das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataExpired);
                    das.deleteFromPersistentStorage = jest.fn().mockResolvedValue(cacheDataExpired);
                });
                it("deletes the data from the cache", async () => {
                    await das.tryPersistentStorageFetching(request);
                    expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                });
                describe("when fail to remove", () => {
                    beforeEach(() => {
                        das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("Test");
                        das.options.logError = jest.fn();
                    });
                    it("calls the option log", async () => {
                        try {
                            await das.tryPersistentStorageFetching(request);
                            expect(das.options.logError).toHaveBeenCalledTimes(1);
                        } catch{

                        }
                    });
                });
            });
            describe("when persistent cache has a fresh data", () => {
                beforeEach(() => {
                    das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataNotExpired);
                });
                it("returns the data with memory cache source", async () => {
                    const result = await das.tryPersistentStorageFetching(request);
                    expect(result.source).toBe(DataSource.PersistentStorageCache);
                });
            });
        });
        describe("when doesn't have the data", () => {
            beforeEach(() => {
                das.getPersistentStoreData = jest.fn().mockResolvedValue(undefined);
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(request);
                expect(result).toBeUndefined();
            });
        });
        describe("when reject promise", () => {
            beforeEach(() => {
                das.getPersistentStoreData = jest.fn().mockRejectedValue("Test");
                das.options.logError = jest.fn();
            });
            it("calls the option log", async () => {
                try {
                    await das.tryPersistentStorageFetching(request);
                    expect(das.options.logError).toHaveBeenCalledTimes(1);
                } catch{

                }
            });
        });
        describe("deleteDataFromCache", () => {
            describe("when no option", () => {
                beforeEach(() => {
                    das.deleteFromMemoryCache = jest.fn().mockRejectedValue("test");
                    das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
                });
                it("removes it from the memory cache", () => {
                    das.deleteDataFromCache("1");
                    expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                });
                it("removes it from the persistent cache", () => {
                    das.deleteDataFromCache("1");
                    expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                });
            });
            describe("when option", () => {
                beforeEach(() => {
                    das.deleteFromMemoryCache = jest.fn().mockRejectedValue("test");
                    das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
                });
                describe("when memory option only", () => {
                    let options: DeleteCacheOptions
                    beforeEach(() => {
                        options = { memory: true };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(0);
                    });
                });
                describe("when memory option true, persistence false", () => {
                    let options: DeleteCacheOptions
                    beforeEach(() => {
                        options = { memory: true, persistent: false };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(0);
                    });
                });
                describe("when persistence option only", () => {
                    let options: DeleteCacheOptions
                    beforeEach(() => {
                        options = { persistent: true };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(0);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                    });
                });
                describe("when persistence true, memory false", () => {
                    let options: DeleteCacheOptions
                    beforeEach(() => {
                        options = { persistent: true, memory: false };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(0);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache("1", options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                    });
                });
            });
        });
    });
    describe("addInMemoryCache", () => {
        describe("when add an object", () => {
            let originalObject: FakeObject;
            beforeEach(() => {
                originalObject = { id: "1", name: "Test1" };
            });
            it("adds a copy of the data to add", () => {
                das.addInMemoryCache("1", 10, originalObject);
                const result = das.getMemoryStoreData("1");
                expect(result.payload).not.toBe(originalObject);
            });
        });
        describe("when add an array", () => {
            let originalArray: FakeObject[];
            beforeEach(() => {
                originalArray = [];
                originalArray.push({ id: "1", name: "Test1" });
            });
            it("returns an array", () => {
                das.addInMemoryCache("1", 10, originalArray);
                const result = das.getMemoryStoreData("1");
                expect(result.payload instanceof Array).toBeTruthy();
            });
        })
    });
});