package com.tasf.planner.model;

public class Airport {
    private final String code;
    private final String region;
    private final int warehouseCapacity;

    public Airport(String code, String region, int warehouseCapacity) {
        this.code = code;
        this.region = region;
        this.warehouseCapacity = warehouseCapacity;
    }

    public String getCode() {
        return code;
    }

    public String getRegion() {
        return region;
    }

    public int getWarehouseCapacity() {
        return warehouseCapacity;
    }
}