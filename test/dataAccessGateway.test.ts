import { DataAccessSingleton } from "../src/dataAccessGateway";
import { AjaxRequest, CachedData, DataSource, DataResponse } from "../src/model";
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
describe("DataAccessSingleton", () => {
    let das: DataAccessSingleton;
    let request: AjaxRequest;
    beforeEach(() => {
        das = new DataAccessSingleton();
        das.addInPersistentStore = jest.fn().mockRejectedValue("test");
        das.getPersistentStoreData = jest.fn().mockRejectedValue("test");
        das.removePersistentStorage = jest.fn().mockRejectedValue("test");
        request = {
            request: {
                url: "http://request"
            }
        };
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
        describe("with version provided", () => {
            beforeEach(() => {
                das.openIndexDb.changeVersion = jest.fn();
            });
            it("change the indexdb version", () => {
                das.setConfiguration({ version: 100 });
                expect(das.openIndexDb.changeVersion).toHaveBeenCalledTimes(1);
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
                        });
                        it("invokes fetch (but won't fetch)", async () => {
                            await das.fetchFast(request);
                            expect(das.fetchAndSaveInCacheIfExpired).toHaveBeenCalledTimes(1);
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
            });
        });
    });
    describe("fetchAndSaveInCacheIfExpired", () => {
        let source: DataSource;
        let cacheEntry: CachedData<string> | undefined;
        beforeEach(() => {
            das.fetchWithAjax = jest.fn().mockResolvedValue(cacheDataNotExpired);
            das.saveCache = jest.fn();
        });
        describe("when cacheEntry is undefined", () => {
            beforeEach(() => {
                cacheEntry = undefined;
            });
            it("fetches with an AJAX call the data remotely", async () => {
                await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(1);
            });
            it("saves the fetched result in the cache", async () => {
                await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(das.saveCache).toHaveBeenCalledTimes(1);
            });
        });
        describe("when data has expired", () => {
            beforeEach(() => {
                cacheEntry = cacheDataExpired;
            });
            it("fetches with an AJAX call the data remotely", async () => {
                await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(das.fetchWithAjax).toHaveBeenCalledTimes(1);
            });
            it("saves the fetched result in the cache", async () => {
                await das.fetchAndSaveInCacheIfExpired(request, source, cacheEntry);
                expect(das.saveCache).toHaveBeenCalledTimes(1);
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
            describe("when saving in persistent storage fail to save", () => {
                beforeEach(() => {
                    das.addInPersistentStore = jest.fn().mockRejectedValue("Error");
                    das.options.log = jest.fn();
                });
                it("calls the option log", async () => {
                    await das.saveCache(request, response);
                    expect(das.options.log).toHaveBeenCalledTimes(1);
                });
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
            das.fetchWithAjax = jest.fn().mockResolvedValue(cacheDataNotExpired);
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
                    das.removePersistentStorage = jest.fn().mockResolvedValue(cacheDataExpired);
                });
                it("deletes the data from the cache", async () => {
                    await das.tryPersistentStorageFetching(request);
                    expect(das.removePersistentStorage).toHaveBeenCalledTimes(1);
                });
                describe("when fail to remove", () => {
                    beforeEach(() => {
                        das.removePersistentStorage = jest.fn().mockRejectedValue("Test");
                        das.options.log = jest.fn();
                    });
                    it("calls the option log", async () => {
                        try {
                            await das.tryPersistentStorageFetching(request);
                            expect(das.options.log).toHaveBeenCalledTimes(1);
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
                das.options.log = jest.fn();
            });
            it("calls the option log", async () => {
                try {
                    await das.tryPersistentStorageFetching(request);
                    expect(das.options.log).toHaveBeenCalledTimes(1);
                } catch{

                }
            });
        });
    });
});