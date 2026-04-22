package com.tasf.planner.core;
 
public class ScenarioConfig {
    private final int maxLegs;
    private final int minConnectionHours;
    private final double tardinessPenalty;
    private final double transferPenalty;
    private final double waitingPenalty;
    private final double unplannedPenalty;
    private final double warehousePenalty;
 
    public ScenarioConfig(
            int maxLegs,
            int minConnectionHours,
            double tardinessPenalty,
            double transferPenalty,
            double waitingPenalty,
            double unplannedPenalty,
            double warehousePenalty) {
        this.maxLegs = maxLegs;
        this.minConnectionHours = minConnectionHours;
        this.tardinessPenalty = tardinessPenalty;
        this.transferPenalty = transferPenalty;
        this.waitingPenalty = waitingPenalty;
        this.unplannedPenalty = unplannedPenalty;
        this.warehousePenalty = warehousePenalty;
    }
 
    public static ScenarioConfig defaultWeek4() {
        return new ScenarioConfig(2, 2, 30.0, 4.0, 0.8, 500.0, 100.0);
    }
 
    public int getMaxLegs() {
        return maxLegs;
    }
 
    public int getMinConnectionHours() {
        return minConnectionHours;
    }
 
    public double getTardinessPenalty() {
        return tardinessPenalty;
    }
 
    public double getTransferPenalty() {
        return transferPenalty;
    }
 
    public double getWaitingPenalty() {
        return waitingPenalty;
    }
 
    public double getUnplannedPenalty() {
        return unplannedPenalty;
    }
 
    public double getWarehousePenalty() {
        return warehousePenalty;
    }
}
