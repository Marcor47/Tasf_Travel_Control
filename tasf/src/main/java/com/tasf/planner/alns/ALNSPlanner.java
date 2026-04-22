package com.tasf.planner.alns;
 
import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.RouteEvaluator;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.RoutePlan;
 
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
 
public class ALNSPlanner {
    private final PlanningContext context;
    private final RouteEvaluator evaluator;
    private final Random random;
 
    private final List<String> destroyOperators = List.of(
            "randomDestroy",
            "worstDestroy",
            "cancelDestroy");
    private final List<String> repairOperators = List.of(
            "greedyRepair",
            "regretRepair");
 
    private final Map<String, Double> destroyWeights = new HashMap<>();
    private final Map<String, Double> repairWeights = new HashMap<>();
 
    public ALNSPlanner(PlanningContext context, long seed) {
        this.context = context;
        this.evaluator = new RouteEvaluator(context);
        this.random = new Random(seed);
        destroyOperators.forEach(op -> destroyWeights.put(op, 1.0));
        repairOperators.forEach(op -> repairWeights.put(op, 1.0));
    }
 
    public WorkingSolution solve(
            List<BaggageLot> lots,
            int iterations,
            String cancelledFlightId) {
        Map<String, List<RoutePlan>> candidateMap = new HashMap<>();
        for (BaggageLot lot : lots) {
            candidateMap.put(lot.getId(), evaluator.enumerateCandidates(lot));
        }
 
        WorkingSolution current = seedGreedy(lots, candidateMap);
        WorkingSolution best = current.copy();
        double currentScore = evaluator.solutionScore(lots, current);
        double bestScore = currentScore;
        double temperature = 50.0;
 
        for (int iteration = 0; iteration < iterations; iteration++) {
            String destroyOp = pickWeighted(destroyWeights);
            String repairOp = pickWeighted(repairWeights);
 
            WorkingSolution trial = current.copy();
            List<BaggageLot> removed = destroy(
                    destroyOp, lots, trial, cancelledFlightId);
            repair(repairOp, removed, candidateMap, trial);
 
            double trialScore = evaluator.solutionScore(lots, trial);
            boolean accepted = trialScore < currentScore
                    || random.nextDouble() < Math.exp(
                            (currentScore - trialScore) / Math.max(0.001, temperature));
 
            if (accepted) {
                current = trial;
                currentScore = trialScore;
                reward(destroyWeights, destroyOp, 0.3);
                reward(repairWeights, repairOp, 0.3);
            }
 
            if (trialScore < bestScore) {
                best = trial.copy();
                bestScore = trialScore;
                reward(destroyWeights, destroyOp, 0.8);
                reward(repairWeights, repairOp, 0.8);
            }
 
            temperature *= 0.995;
            decayWeights(destroyWeights);
            decayWeights(repairWeights);
        }
        return best;
    }
 
    private WorkingSolution seedGreedy(
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap) {
        WorkingSolution seed = new WorkingSolution(context);
        List<BaggageLot> ordered = new ArrayList<>(lots);
        ordered.sort(Comparator
                .comparing(BaggageLot::isReplanningPriority).reversed()
                .thenComparingInt(BaggageLot::getDueHour));
        for (BaggageLot lot : ordered) {
            for (RoutePlan candidate : candidateMap.getOrDefault(lot.getId(), List.of())) {
                if (seed.canAssign(lot, candidate)) {
                    seed.assign(lot, candidate);
                    break;
                }
            }
        }
        return seed;
    }
 
    private List<BaggageLot> destroy(
            String destroyOp,
            List<BaggageLot> lots,
            WorkingSolution solution,
            String cancelledFlightId) {
        List<BaggageLot> ordered = new ArrayList<>(lots);
        int removeCount = Math.max(1, (int) Math.ceil(lots.size() * 0.25));
 
        if ("worstDestroy".equals(destroyOp)) {
            ordered.sort((a, b) -> {
                double sa = solution.getPlan(a.getId()) == null
                        ? Double.MAX_VALUE
                        : solution.getPlan(a.getId()).getScore();
                double sb = solution.getPlan(b.getId()) == null
                        ? Double.MAX_VALUE
                        : solution.getPlan(b.getId()).getScore();
                return Double.compare(sb, sa);
            });
        } else if ("cancelDestroy".equals(destroyOp)) {
            ordered.sort((a, b) -> {
                boolean ta = solution.getPlan(a.getId()) != null
                        && solution.getPlan(a.getId()).touchesFlight(cancelledFlightId);
                boolean tb = solution.getPlan(b.getId()) != null
                        && solution.getPlan(b.getId()).touchesFlight(cancelledFlightId);
                return Boolean.compare(tb, ta);
            });
        } else {
            java.util.Collections.shuffle(ordered, random);
        }
 
        List<BaggageLot> removed = new ArrayList<>();
        for (int i = 0; i < removeCount && i < ordered.size(); i++) {
            BaggageLot lot = ordered.get(i);
            if (solution.getPlan(lot.getId()) != null) {
                solution.remove(lot);
                removed.add(lot);
            }
        }
        return removed;
    }
 
    private void repair(
            String repairOp,
            List<BaggageLot> removed,
            Map<String, List<RoutePlan>> candidateMap,
            WorkingSolution solution) {
        if ("regretRepair".equals(repairOp)) {
            regretRepair(removed, candidateMap, solution);
        } else {
            greedyRepair(removed, candidateMap, solution);
        }
    }
 
    private void greedyRepair(
            List<BaggageLot> removed,
            Map<String, List<RoutePlan>> candidateMap,
            WorkingSolution solution) {
        removed.sort(Comparator
                .comparing(BaggageLot::isReplanningPriority).reversed()
                .thenComparingInt(BaggageLot::getDueHour));
        for (BaggageLot lot : removed) {
            for (RoutePlan candidate : candidateMap.getOrDefault(lot.getId(), List.of())) {
                if (solution.canAssign(lot, candidate)) {
                    solution.assign(lot, candidate);
                    break;
                }
            }
        }
    }
 
    private void regretRepair(
            List<BaggageLot> removed,
            Map<String, List<RoutePlan>> candidateMap,
            WorkingSolution solution) {
        List<BaggageLot> pending = new ArrayList<>(removed);
        while (!pending.isEmpty()) {
            BaggageLot bestLot = null;
            RoutePlan bestPlan = null;
            double bestRegret = -1.0;
 
            for (BaggageLot lot : pending) {
                List<RoutePlan> feasible = new ArrayList<>();
                for (RoutePlan candidate : candidateMap.getOrDefault(lot.getId(), List.of())) {
                    if (solution.canAssign(lot, candidate)) {
                        feasible.add(candidate);
                    }
                }
                if (feasible.isEmpty()) {
                    continue;
                }
                feasible.sort(Comparator.comparingDouble(RoutePlan::getScore));
                double first = feasible.get(0).getScore();
                double second = feasible.size() > 1
                        ? feasible.get(1).getScore()
                        : first + 100.0;
                double regret = second - first;
                if (regret > bestRegret) {
                    bestRegret = regret;
                    bestLot = lot;
                    bestPlan = feasible.get(0);
                }
            }
 
            if (bestLot == null) {
                break;
            }
            solution.assign(bestLot, bestPlan);
            pending.remove(bestLot);
        }
    }
 
    private String pickWeighted(Map<String, Double> weights) {
        double total = weights.values().stream()
                .mapToDouble(Double::doubleValue)
                .sum();
        double threshold = random.nextDouble() * total;
        double acc = 0.0;
        for (Map.Entry<String, Double> entry : weights.entrySet()) {
            acc += entry.getValue();
            if (acc >= threshold) {
                return entry.getKey();
            }
        }
        return weights.keySet().iterator().next();
    }
 
    private void reward(Map<String, Double> weights, String key, double delta) {
        weights.computeIfPresent(key, (k, v) -> v + delta);
    }
 
    private void decayWeights(Map<String, Double> weights) {
        weights.replaceAll((k, v) -> Math.max(0.2, v * 0.999));
    }
}
