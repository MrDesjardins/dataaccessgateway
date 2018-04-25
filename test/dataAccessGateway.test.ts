import { DataAccessSingleton } from "../src/dataAccessGateway";
import { AjaxRequest, CachedData, DataSource } from "../src/model";
const cacheDataExpired: CachedData<string> = {
    expirationDateTime: new Date(new Date().getTime() - 10000),
    payload: "Test"
};
const cacheDataNotExpired: CachedData<string> = {
    expirationDateTime: new Date(new Date().getTime() + 10000),
    payload: "Test"
};
describe("DataAccessSingleton", () => {
    let das: DataAccessSingleton;
    beforeEach(() => {
        das = new DataAccessSingleton();
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
                expect(das.options.defaultLifeSpanInMinute).toBe(das.DefaultOptions.defaultLifeSpanInMinute);
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
            });
        });
    });
});