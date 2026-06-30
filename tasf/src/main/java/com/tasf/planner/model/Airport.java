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
    private int    warehouseCapacity;
    private final int    gmtOffset;          // en minutos respecto a UTC
    private final double latitude;
    private final double longitude;
 
    public Airport(String code, String region, int warehouseCapacity, int gmtOffset) {
        this(code, region, warehouseCapacity, gmtOffset, 0.0, 0.0);
    }

    public Airport(String code, String region, int warehouseCapacity, int gmtOffset,
                   double latitude, double longitude) {
        this.code             = code;
        this.region           = region;
        this.warehouseCapacity = warehouseCapacity;
        this.gmtOffset        = gmtOffset;
        this.latitude         = latitude;
        this.longitude        = longitude;
    }
 
    public String getCode()              { return code; }
    public String getRegion()            { return region; }
    public int    getWarehouseCapacity() { return warehouseCapacity; }
    public double getLatitude()          { return latitude; }
    public double getLongitude()         { return longitude; }

    public void setCapacity(int warehouseCapacity) {
        this.warehouseCapacity = warehouseCapacity;
    }
 
    /**
     * Offset respecto a UTC, en minutos.
     * Para convertir hora local a UTC:  utcMinutes = localMinutes - gmtOffset
     */
    public int getGmtOffset() { return gmtOffset; }
}
 
