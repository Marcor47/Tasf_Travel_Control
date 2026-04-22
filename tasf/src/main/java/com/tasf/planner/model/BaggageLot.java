package com.tasf.planner.model;
 
public class BaggageLot {
    private final String id;
    private final String origin;
    private final String destination;
    private final int quantity;
    private final int registrationHour;
    private final int dueHour;
    private final boolean replanningPriority;
 
    public BaggageLot(
            String id,
            String origin,
            String destination,
            int quantity,
            int registrationHour,
            int dueHour,
            boolean replanningPriority) {
        this.id = id;
        this.origin = origin;
        this.destination = destination;
        this.quantity = quantity;
        this.registrationHour = registrationHour;
        this.dueHour = dueHour;
        this.replanningPriority = replanningPriority;
    }
 
    public String getId() {
        return id;
    }
 
    public String getOrigin() {
        return origin;
    }
 
    public String getDestination() {
        return destination;
    }
 
    public int getQuantity() {
        return quantity;
    }
 
    public int getRegistrationHour() {
        return registrationHour;
    }
 
    public int getDueHour() {
        return dueHour;
    }
 
    public boolean isReplanningPriority() {
        return replanningPriority;
    }
 
    public int slackHours() {
        return dueHour - registrationHour;
    }
}
