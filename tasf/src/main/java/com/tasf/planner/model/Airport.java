package com.tasf.planner.model;
 
/**
 * Representa un aeropuerto con su zona horaria.
 *
 * gmtOffset se almacena en MINUTOS para ser consistente con el resto del
 * sistema (departure/arrival/registrationTime todos en minutos).
 * Ejemplo: GMT -5  →  gmtOffset = -300
 *          GMT +1  →  gmtOffset =  +60
 */
public class Airport {
 
    private final String code;
    private final String region;
    private final int    warehouseCapacity;
    private final int    gmtOffset;          // en minutos respecto a UTC
 
    public Airport(String code, String region, int warehouseCapacity, int gmtOffset) {
        this.code             = code;
        this.region           = region;
        this.warehouseCapacity = warehouseCapacity;
        this.gmtOffset        = gmtOffset;
    }
 
    public String getCode()              { return code; }
    public String getRegion()            { return region; }
    public int    getWarehouseCapacity() { return warehouseCapacity; }
 
    /**
     * Offset respecto a UTC, en minutos.
     * Para convertir hora local a UTC:  utcMinutes = localMinutes - gmtOffset
     */
    public int getGmtOffset() { return gmtOffset; }
}
 
