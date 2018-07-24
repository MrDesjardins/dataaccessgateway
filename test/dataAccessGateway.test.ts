import { AxiosResponse } from "axios";
import hash from "object-hash";
import { DataAccessIndexDbDatabase, DataAccessSingleton, DeleteCacheOptions } from "../src/dataAccessGateway";
import { AjaxRequest, AjaxRequestWithId, CacheConfiguration, CachedData, DataResponse, DataSource, OnGoingAjaxRequest, PerformanceRequestInsight } from "../src/model";
import { getMockAjaxRequest, getMockAjaxRequestWithId, getMockAxiosRequestConfig, getMockOnGoingAjaxRequest, getPromiseRetarder, PromiseRetarder } from "./dataAccessGateway.mock";
const DATABASE_NAME = "Test";
interface FakeObject {
    id: string;
    name: string;
}
const cacheDataExpired: CachedData<string> = {
    expirationDateTime: new Date(new Date().getTime() - 10000),
    payload: "Test"
};
const cacheDataNotExpired: CachedData<string> = {
    expirationDateTime: new Date(new Date().getTime() + 10000),
    payload: "Test"
};
const dataResponseFromCache: DataResponse<string> = {
    result: "Test",
    source: DataSource.HttpRequest
};
const defaultPerformanceInsight: PerformanceRequestInsight = {
    fetch: {
        startMs: 0
    }
};
describe("DataAccessIndexDbDatabase", () => {
    let didb: DataAccessIndexDbDatabase;
    beforeEach(() => {
        didb = new DataAccessIndexDbDatabase("");
    });
    describe("dropTable", () => {
        describe("when data is definFed", () => {
            beforeEach(() => {
                didb.data = { clear: () => {} } as any;
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
    let requestWithId: AjaxRequestWithId;
    let ajaxResponse: AxiosResponse<string>;
    let spySetDefaultRequestId: jest.SpyInstance<(request: AjaxRequest) => void>;

    beforeEach(() => {
        das = new DataAccessSingleton(DATABASE_NAME);
        spySetDefaultRequestId = jest.spyOn(das, "setDefaultRequestId");
        das.addInPersistentStore = jest.fn().mockRejectedValue("test");
        das.getPersistentStoreData = jest.fn().mockRejectedValue("test");
        das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
        das.options.logInfo = jest.fn();
        das.options.logError = jest.fn();
        request = {
            request: {
                url: "http://request"
            }
        };
        requestWithId = {
            id: "id",
            request: {
                url: "http://request"
            }
        };
        ajaxResponse = {
            status: 200,
            data: "payload",
            statusText: "Good",
            config: {},
            headers: {}
        };
    });
    afterEach(() => {
        spySetDefaultRequestId.mockRestore();
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
            it("returns the same instance", () => {
                // This is until we support many instances
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
                it("uses the whole request hashed has the id", () => {
                    das.setDefaultRequestId(request);
                    expect(request.id).toEqual(hash.sha1(JSON.stringify(request.request)));
                });
            });
        });
    });

    describe("setDefaultCache", () => {
        beforeEach(() => {
            request = {
                request: {}
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
                request: {}
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
                das.setDefaultFastCache = jest.fn();
                das.fetchAndSaveInCacheIfExpired = jest.fn().mockResolvedValue(dataResponseFromCache);
            });
            it("always set default request id", () => {
                das.fetchFast(request);
                expect(spySetDefaultRequestId).toHaveBeenCalledTimes(1);
            });
            it("always set default fast cache option", () => {
                das.fetchFast(request);
                expect(das.setDefaultFastCache).toHaveBeenCalledTimes(1);
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
    describe("fetchAndSaveInCacheIfExpired", () => {
        let source: DataSource;
        let cacheEntry: CachedData<string> | undefined;
        beforeEach(() => {
            das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
            das.saveCache = jest.fn();
            request.id = "http://test";
        });
        describe("when cacheEntry is undefined", () => {
            beforeEach(() => {
                cacheEntry = undefined;
                ajaxResponse.status = 500;
            });
            it("fetches with an AJAX call the data remotely", async () => {
                try {
                    await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                } catch (e) {}
                expect(das.saveCache).toHaveBeenCalledTimes(0);
            });
            describe("when status code is 200", () => {
                beforeEach(() => {
                    ajaxResponse.status = 200;
                    das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
                });

                it("saves the fetched result in the cache", async () => {
                    await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                    expect(das.saveCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when status code is 500", () => {
                beforeEach(() => {
                    ajaxResponse.status = 500;
                });
                it("does not save in cache", async () => {
                    try {
                        await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
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
                    await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                } catch (e) {}
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(1);
            });
            describe("when status code is 200", () => {
                beforeEach(() => {
                    ajaxResponse.status = 200;
                });
                it("saves the fetched result in the cache", async () => {
                    await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                    expect(das.saveCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when status code is 500", () => {
                beforeEach(() => {
                    ajaxResponse.status = 500;
                });
                it("does not save in cache", async () => {
                    try {
                        await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
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
                await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(0);
            });
            it("returns the payload of the original data", async () => {
                const result = await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
                expect(result.result).toEqual(cacheDataNotExpired.payload);
            });
            it("returns the original source", async () => {
                const result = await das.fetchAndSaveInCacheIfExpired(requestWithId, source, cacheEntry);
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
                await das.saveCache(requestWithId, response);
                expect(das.addInMemoryCache).toHaveBeenCalledTimes(0);
            });
        });
        describe("when memory cache is defined", () => {
            beforeEach(() => {
                requestWithId.memoryCache = {
                    lifespanInSeconds: 120
                };
            });
            it("adds in the memory cache", async () => {
                await das.saveCache(requestWithId, response);
                expect(das.addInMemoryCache).toHaveBeenCalledTimes(1);
            });
        });
        describe("when persistent cache is undefined", () => {
            beforeEach(() => {
                requestWithId.persistentCache = undefined;
            });
            it("does NOT add in the persistent cache", async () => {
                await das.saveCache(requestWithId, response);
                expect(das.addInPersistentStore).toHaveBeenCalledTimes(0);
            });
        });
        describe("when persistent cache is defined", () => {
            beforeEach(() => {
                requestWithId.persistentCache = {
                    lifespanInSeconds: 120
                };
            });
            it("adds in the persistent cache", async () => {
                await das.saveCache(requestWithId, response);
                expect(das.addInPersistentStore).toHaveBeenCalledTimes(1);
            });
        });
        it("returns the response from the parameter", async () => {
            const result = await das.saveCache(requestWithId, response);
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
            das.setDefaultCache = jest.fn();
            das.fetchAndSaveInCacheIfExpired = jest.fn();
            das.tryMemoryCacheFetching = jest.fn().mockRejectedValue("test");
            das.tryPersistentStorageFetching = jest.fn().mockRejectedValue("test");
            das.fetchWithAjax = jest.fn().mockResolvedValue(ajaxResponse);
            das.saveCache = jest.fn().mockResolvedValue(cacheDataNotExpired);
        });
        it("always call the default request id configuration", () => {
            das.fetchFresh(request);
            expect(spySetDefaultRequestId).toHaveBeenCalledTimes(1);
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
            describe("when tryPersistentStorageFetching fail", () => {
                beforeEach(() => {
                    das.tryPersistentStorageFetching = jest.fn().mockRejectedValue("Error");
                    das.deletePerformanceInsight = jest.fn();
                });
                it("deletes performance insight", async () => {
                    try {
                        await das.fetchFresh(request);
                    } catch {}
                    expect(das.deletePerformanceInsight).toHaveBeenCalledTimes(1);
                });
            });
        });
    });
    describe("tryMemoryCacheFetching", () => {
        beforeEach(() => {
            requestWithId.memoryCache = {
                lifespanInSeconds: 120
            };
        });
        describe("when cache configuration is undefined", () => {
            beforeEach(() => {
                requestWithId.memoryCache = undefined;
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(requestWithId);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache disabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = false;
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(requestWithId);
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
                    await das.tryMemoryCacheFetching(requestWithId);
                    expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                });
            });
            describe("when memory cache has a fresh data", () => {
                beforeEach(() => {
                    das.getMemoryStoreData = jest.fn().mockReturnValue(cacheDataNotExpired);
                    das.deleteFromMemoryCache = jest.fn();
                });
                it("returns the data with memory cache source", async () => {
                    const result = await das.tryMemoryCacheFetching(requestWithId);
                    expect(result.source).toBe(DataSource.MemoryCache);
                });
            });
        });
        describe("when doesn't have the data", () => {
            beforeEach(() => {
                das.getMemoryStoreData = jest.fn().mockReturnValue(undefined);
            });
            it("returns undefined", async () => {
                const result = await das.tryMemoryCacheFetching(requestWithId);
                expect(result).toBeUndefined();
            });
        });
    });
    describe("tryPersistentStorageFetching", () => {
        beforeEach(() => {
            requestWithId.persistentCache = {
                lifespanInSeconds: 120
            };
        });
        describe("when cache configuration is undefined", () => {
            beforeEach(() => {
                requestWithId.persistentCache = undefined;
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(requestWithId);
                expect(result).toBeUndefined();
            });
        });
        describe("when cache disabled", () => {
            beforeEach(() => {
                das.options.isCacheEnabled = false;
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(requestWithId);
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
                    await das.tryPersistentStorageFetching(requestWithId);
                    expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                });
                describe("when fail to remove", () => {
                    beforeEach(() => {
                        das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("Test");
                        das.options.logError = jest.fn();
                    });
                    it("calls the option log", async () => {
                        try {
                            await das.tryPersistentStorageFetching(requestWithId);
                            expect(das.options.logError).toHaveBeenCalledTimes(1);
                        } catch {}
                    });
                });
            });
            describe("when persistent cache has a fresh data", () => {
                beforeEach(() => {
                    das.getPersistentStoreData = jest.fn().mockResolvedValue(cacheDataNotExpired);
                });
                it("returns the data with memory cache source", async () => {
                    const result = await das.tryPersistentStorageFetching(requestWithId);
                    expect(result.source).toBe(DataSource.PersistentStorageCache);
                });
            });
        });
        describe("when doesn't have the data", () => {
            beforeEach(() => {
                das.getPersistentStoreData = jest.fn().mockResolvedValue(undefined);
            });
            it("returns undefined", async () => {
                const result = await das.tryPersistentStorageFetching(requestWithId);
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
                    await das.tryPersistentStorageFetching(requestWithId);
                    expect(das.options.logError).toHaveBeenCalledTimes(1);
                } catch {}
            });
        });
        describe("deleteDataFromCache", () => {
            let requestWithId: AjaxRequest;
            beforeEach(() => {
                requestWithId = { id: "1", request: getMockAxiosRequestConfig() };
            });
            describe("when no option", () => {
                beforeEach(() => {
                    das.deleteFromMemoryCache = jest.fn().mockRejectedValue("test");
                    das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
                });
                it("removes it from the memory cache", () => {
                    das.deleteDataFromCache(requestWithId);
                    expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                });
                it("removes it from the persistent cache", () => {
                    das.deleteDataFromCache(requestWithId);
                    expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                });
            });
            describe("when option", () => {
                beforeEach(() => {
                    das.deleteFromMemoryCache = jest.fn().mockRejectedValue("test");
                    das.deleteFromPersistentStorage = jest.fn().mockRejectedValue("test");
                });
                describe("when memory option only", () => {
                    let options: DeleteCacheOptions;
                    beforeEach(() => {
                        options = { memory: true };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(0);
                    });
                });
                describe("when memory option true, persistence false", () => {
                    let options: DeleteCacheOptions;
                    beforeEach(() => {
                        options = { memory: true, persistent: false };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(1);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(0);
                    });
                });
                describe("when persistence option only", () => {
                    let options: DeleteCacheOptions;
                    beforeEach(() => {
                        options = { persistent: true };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(0);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                    });
                });
                describe("when persistence true, memory false", () => {
                    let options: DeleteCacheOptions;
                    beforeEach(() => {
                        options = { persistent: true, memory: false };
                    });
                    it("removes it from the memory cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromMemoryCache).toHaveBeenCalledTimes(0);
                    });
                    it("does NOT remove it from the persistent cache", () => {
                        das.deleteDataFromCache(requestWithId, options);
                        expect(das.deleteFromPersistentStorage).toHaveBeenCalledTimes(1);
                    });
                });
            });
        });
    });
    describe("addInMemoryCache", () => {
        let requestWithId: AjaxRequestWithId;
        beforeEach(() => {
            requestWithId = getMockAjaxRequestWithId("1");
            requestWithId.memoryCache = { lifespanInSeconds: 10 };
        });
        describe("when add an object", () => {
            let originalObject: FakeObject;
            beforeEach(() => {
                originalObject = { id: "1", name: "Test1" };
            });
            it("adds a copy of the data to add", () => {
                das.addInMemoryCache(requestWithId, originalObject);
                const result = das.getMemoryStoreData(requestWithId);
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
                das.addInMemoryCache(requestWithId, originalArray);
                const result = das.getMemoryStoreData(requestWithId);
                expect(result.payload instanceof Array).toBeTruthy();
            });
        });
    });

    describe("fetchWithAjax", () => {
        const requestId = "id1";
        const requestData = "data";
        let request: AjaxRequest;
        let requestWithId: AjaxRequestWithId;
        let onGoingPromise: OnGoingAjaxRequest;
        beforeEach(() => {
            request = getMockAjaxRequest(requestId);
            requestWithId = getMockAjaxRequestWithId(requestId);
            das.ajax = jest.fn().mockResolvedValue(request.request);
        });
        describe("when request is already on-going", () => {
            beforeEach(() => {
                onGoingPromise = getMockOnGoingAjaxRequest(requestId, requestData);
                das.onGoingAjaxRequest.set(requestId, onGoingPromise);
            });
            it("returns the on-going promise", () => {
                const result = das.fetchWithAjax(request);
                expect(result).toBe(onGoingPromise.promise);
            });
            it("does not do another Ajax call", () => {
                das.fetchWithAjax(request);
                expect(das.ajax).not.toHaveBeenCalled();
            });
        });
        describe("when not an already on-going request", () => {
            beforeEach(() => {
                onGoingPromise = getMockOnGoingAjaxRequest(requestId, requestData);
                das.onGoingAjaxRequest.clear();
            });
            it("performs the Ajax call", () => {
                das.fetchWithAjax(request);
                expect(das.ajax).toHaveBeenCalledTimes(1);
            });
            it("adds a new on-going request", () => {
                das.fetchWithAjax(request);
                expect(das.onGoingAjaxRequest.size).toEqual(1);
            });
            describe("when call is successful", () => {
                let promiseNotFulfilled: PromiseRetarder;
                beforeEach(() => {
                    das.ajax = jest.fn().mockResolvedValue("data");
                    promiseNotFulfilled = getPromiseRetarder();
                    jest.fn().mockResolvedValue(promiseNotFulfilled.promise);
                });
                it("removes the on-going request", async () => {
                    const promiseReturn = das.fetchWithAjax(request);
                    promiseNotFulfilled.resolveNow();
                    promiseReturn.then(() => {
                        expect(das.onGoingAjaxRequest.size).toEqual(0);
                    });
                });
                it("returns the response", () => {
                    const promiseReturn = das.fetchWithAjax(request);
                    promiseNotFulfilled.resolveNow();
                    promiseReturn.then(v => {
                        expect(v).toEqual("data");
                    });
                });
            });
            describe("when call is a failure", () => {
                let promiseNotFulfilled: PromiseRetarder;
                beforeEach(() => {
                    das.ajax = jest.fn().mockRejectedValue("error");
                    promiseNotFulfilled = getPromiseRetarder();
                    jest.fn().mockResolvedValue(promiseNotFulfilled.promise);
                });
                it("removes the on-going request", () => {
                    const promiseReturn = das.fetchWithAjax(request);
                    promiseNotFulfilled.rejectNow();
                    expect(das.onGoingAjaxRequest.size).toEqual(1);
                    promiseReturn.catch(() => {
                        expect(das.onGoingAjaxRequest.size).toEqual(0);
                    });
                    expect.assertions(2);
                });
                it("rejects the promise", () => {
                    const promiseReturn = das.fetchWithAjax(request);
                    promiseNotFulfilled.rejectNow();
                    promiseReturn.catch(e => {
                        expect(e).toBeDefined();
                    });
                    expect.assertions(1);
                });
            });
        });
    });

    describe("deleteFromMemoryCache", () => {
        let request: AjaxRequestWithId;
        beforeEach(() => {
            request = getMockAjaxRequestWithId("id");
            das.cachedResponse.delete = jest.fn();
        });
        it("calls the delete on the cache", () => {
            das.deleteFromMemoryCache(request);
            expect(das.cachedResponse.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe("deleteonGoingAjaxRequest", () => {
        beforeEach(() => {
            das.onGoingAjaxRequest.delete = jest.fn();
        });
        it("removes from on-going list", () => {
            das.deleteOnGoingAjaxRequest("id", "");
            expect(das.onGoingAjaxRequest.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe("fetchWeb", () => {
        let request: AjaxRequest;
        beforeEach(() => {
            request = {
                request: {
                    url: "http://request"
                }
            };
            das.setConfiguration({ isCacheEnabled: true });
            das.setDefaultCache = jest.fn();
            das.deletePerformanceInsight = jest.fn();
            das.fetchAndSaveInCacheIfExpired = jest.fn().mockResolvedValue(ajaxResponse);
            das.tryMemoryCacheFetching = jest.fn().mockRejectedValue("test");
        });
        it("always call the default request id configuration", () => {
            das.fetchWeb(request);
            expect(spySetDefaultRequestId).toHaveBeenCalledTimes(1);
        });
        it("always call the fetch and save", () => {
            das.fetchWeb(request);
            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
        });
        it("never call the default cache", () => {
            das.fetchWeb(request);
            expect(das.setDefaultCache).toHaveBeenCalledTimes(0);
        });
        it("never call memory cache", () => {
            das.fetchWeb(request);
            expect(das.tryMemoryCacheFetching).toHaveBeenCalledTimes(0);
        });
        describe("when fail to fetch", () => {
            beforeEach(() => {
                das.fetchAndSaveInCacheIfExpired = jest.fn().mockRejectedValue("Error");
            });
            it("deletes performance insight", async () => {
                try {
                    await das.fetchWeb(request);
                } catch {}
                expect(das.deletePerformanceInsight).toHaveBeenCalledTimes(1);
            });
        });
        // fit("calls logInfo", () => {
        //     das.fetchWeb(request);
        //     expect(das.options.logInfo).toHaveBeenCalledTimes(1);
        // });
    });

    describe("startPerformanceInsight", () => {
        beforeEach(() => {
            das.getPerformanceInsight = jest.fn().mockReturnValue(defaultPerformanceInsight);
        });
        describe("insight is an id", () => {
            let request: string;
            beforeEach(() => {
                request = "123";
            });
            it("calls getPerformanceInsight", () => {
                das.startPerformanceInsight(request);
                expect(das.getPerformanceInsight).toHaveBeenCalledTimes(1);
            });
        });
        describe("insight is a Performance Request", () => {
            let request: PerformanceRequestInsight;
            beforeEach(() => {
                request = defaultPerformanceInsight;
            });
            it("calls does not call getPerformanceInsight", () => {
                das.startPerformanceInsight(request);
                expect(das.getPerformanceInsight).toHaveBeenCalledTimes(0);
            });
        });
        describe("sets http request", () => {
            let request: PerformanceRequestInsight;
            let source: DataSource | undefined;
            beforeEach(() => {
                request = defaultPerformanceInsight;
            });
            describe("when source is undefined", () => {
                beforeEach(() => {
                    source = undefined;
                });
                it("sets the overall fetch start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.fetch).not.toBe(ref.fetch);
                });
                it("has no stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.fetch.stopMs).toBeUndefined();
                });
            });
            describe("when source is HttpRequest", () => {
                beforeEach(() => {
                    source = DataSource.HttpRequest;
                });
                it("sets the httpRequest start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.httpRequest).not.toBe(ref.httpRequest);
                });
                it("has no stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.httpRequest.stopMs).toBeUndefined();
                });
            });
            describe("when source is MemoryCache", () => {
                beforeEach(() => {
                    source = DataSource.MemoryCache;
                });
                it("sets the memoryCache start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.memoryCache).not.toBe(ref.memoryCache);
                });
                it("has no stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.memoryCache.stopMs).toBeUndefined();
                });
            });
            describe("when source is PersistentStorageCache", () => {
                beforeEach(() => {
                    source = DataSource.PersistentStorageCache;
                });
                it("sets the persistentStorageCache start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.persistentStorageCache).not.toBe(ref.persistentStorageCache);
                });
                it("has no stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.persistentStorageCache.stopMs).toBeUndefined();
                });
            });
            describe("when source is System", () => {
                beforeEach(() => {
                    source = DataSource.System;
                });
                it("change nothing", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.startPerformanceInsight(request, source);
                    expect(result.persistentStorageCache).toBe(ref.persistentStorageCache);
                    expect(result.memoryCache).toBe(ref.memoryCache);
                    expect(result.httpRequest).toBe(ref.httpRequest);
                });
            });
        });
    });
    describe("stopPerformanceInsight", () => {
        beforeEach(() => {
            das.getPerformanceInsight = jest.fn().mockReturnValue(defaultPerformanceInsight);
        });
        describe("insight is an id", () => {
            let request: string;
            beforeEach(() => {
                request = "123";
            });
            it("calls getPerformanceInsight", () => {
                das.stopPerformanceInsight(request);
                expect(das.getPerformanceInsight).toHaveBeenCalledTimes(1);
            });
        });
        describe("insight is a Performance Request", () => {
            let request: PerformanceRequestInsight;
            beforeEach(() => {
                request = defaultPerformanceInsight;
            });
            it("calls does not call getPerformanceInsight", () => {
                das.stopPerformanceInsight(request);
                expect(das.getPerformanceInsight).toHaveBeenCalledTimes(0);
            });
        });
        describe("sets http request", () => {
            let request: PerformanceRequestInsight;
            let source: DataSource | undefined;
            beforeEach(() => {
                request = defaultPerformanceInsight;
            });
            describe("when source is undefined", () => {
                beforeEach(() => {
                    source = undefined;
                    request.fetch.startMs = 120;
                });
                it("keeps the same object for the performance mark", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.fetch).toBe(ref.fetch);
                });
                it("does not change start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.fetch.startMs).toEqual(ref.fetch.startMs);
                });
                it("has stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.fetch.stopMs).toBeDefined();
                });
            });
            describe("when source is HttpRequest", () => {
                beforeEach(() => {
                    source = DataSource.HttpRequest;
                    request.httpRequest.startMs = 220;
                });
                it("keeps the same object for the performance mark", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.httpRequest).toBe(ref.httpRequest);
                });
                it("does not change start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.httpRequest.startMs).toEqual(ref.httpRequest.startMs);
                });
                it("has stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.httpRequest.stopMs).toBeDefined();
                });
            });
            describe("when source is MemoryCache", () => {
                beforeEach(() => {
                    source = DataSource.MemoryCache;
                    request.httpRequest.startMs = 320;
                });
                it("keeps the same object for the performance mark", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.memoryCache).toBe(ref.memoryCache);
                });
                it("does not change start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.memoryCache.startMs).toEqual(ref.memoryCache.startMs);
                });
                it("has stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.memoryCache.stopMs).toBeDefined();
                });
            });
            describe("when source is PersistentStorageCache", () => {
                beforeEach(() => {
                    source = DataSource.PersistentStorageCache;
                    request.httpRequest.startMs = 420;
                });
                it("keeps the same object for the performance mark", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.persistentStorageCache).toBe(ref.persistentStorageCache);
                });
                it("does not change start time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.persistentStorageCache.startMs).toEqual(ref.persistentStorageCache.startMs);
                });
                it("has stop time", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.persistentStorageCache.stopMs).toBeDefined();
                });
            });
            describe("when source is System", () => {
                beforeEach(() => {
                    source = DataSource.System;
                });
                it("change nothing", () => {
                    const ref = { ...defaultPerformanceInsight };
                    const result = das.stopPerformanceInsight(request, source);
                    expect(result.persistentStorageCache).toBe(ref.persistentStorageCache);
                    expect(result.memoryCache).toBe(ref.memoryCache);
                    expect(result.httpRequest).toBe(ref.httpRequest);
                });
            });
        });
    });
    // describe("addInPersistentStore", () => {
    //     describe("when transaction is successful", () => {
    //         beforeEach(() => {
    //             das.openIndexDb.transaction = jest.fn().mockResolvedValue("ok");
    //             das.openIndexDb.data.put= jest.fn().mockResolvedValue("ok");
    //         });
    //         it("removes from on-going list", async () => {
    //             const result = await das.addInPersistentStore("id", cacheDataExpired);
    //             expect(result).toEqual("ok");
    //         });
    //     });
    //     describe("when transaction fails", () => {
    //         beforeEach(() => {
    //             das.openIndexDb.transaction = jest.fn().mockRejectedValue("error");
    //         });
    //         it("removes from on-going list", async () => {
    //             try {
    //                 await das.addInPersistentStore("id", cacheDataExpired);
    //             } catch (e) {
    //                 expect(e).toBeDefined();
    //             }
    //         });
    //         it("calls the logerror", async () => {
    //             await das.addInPersistentStore("id", cacheDataExpired);
    //             expect(das.options.logError).toHaveBeenCalledTimes(1);
    //         });
    //     });
    // });

    // describe("getPersistentStoreData", () => {

    // });

    // describe("deleteFromPersistentStorage", () => {

    // });
});
