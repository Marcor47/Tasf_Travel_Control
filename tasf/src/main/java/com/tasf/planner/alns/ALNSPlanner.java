package com.tasf.planner.alns;

import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.RouteEvaluator;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.RoutePlan;

import java.util.*;

public class ALNSPlanner {

    private static final int    MAX_CANDIDATES    = 8;
    private static final int    MAX_DESTROY_COUNT = 50;
    private static final double DESTROY_RATIO     = 0.01;

    private final PlanningContext context;
    private final RouteEvaluator  evaluator;
    private final Random          random;

    private final List<String> destroyOperators = List.of(
            "randomDestroy", "worstDestroy", "cancelDestroy");
    private final List<String> repairOperators = List.of(
            "greedyRepair", "regretRepair");

    private final Map<String, Double> destroyWeights = new HashMap<>();
    private final Map<String, Double> repairWeights  = new HashMap<>();

    public ALNSPlanner(PlanningContext context, long seed) {
        this.context   = context;
        this.evaluator = new RouteEvaluator(context);
        this.random    = new Random(seed);
        destroyOperators.forEach(op -> destroyWeights.put(op, 1.0));
        repairOperators.forEach(op  -> repairWeights.put(op,  1.0));
    }

    // ── API principal ────────────────────────────────────────────────────────

    /**
     * Resuelve usando el mapa de candidatos precalculado externamente.
     *
     * @param lots                lotes a planificar
     * @param timeBudgetSeconds   presupuesto de tiempo en segundos
     * @param cancelledFlightId   vuelo cancelado para cancelDestroy (null si ninguno)
     * @param candidateMap        mapa precalculado por buildCandidateMap()
     * @param overnightArrivals   llegadas de vuelos overnight del día anterior;
     *                            null o vacío si es el primer día.
     *                            Se inyectan en el timeline del almacén ANTES
     *                            de iniciar el solve, en su minuto real rebased.
     */
    public WorkingSolution solveWithCandidates(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            String cancelledFlightId,
            Map<String, List<RoutePlan>> candidateMap,
            List<WorkingSolution.OvernightArrival> overnightArrivals) {
        return solveWithCandidates(lots, timeBudgetSeconds, 0, cancelledFlightId,
                candidateMap, overnightArrivals);
    }

    /**
     * Resuelve usando presupuesto por tiempo, por iteraciones, o ambos.
     *
     * @param timeBudgetSeconds 0 = sin limite de tiempo
     * @param maxIterations     0 = sin limite de iteraciones
     */
    public WorkingSolution solveWithCandidates(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            int maxIterations,
            String cancelledFlightId,
            Map<String, List<RoutePlan>> candidateMap,
            List<WorkingSolution.OvernightArrival> overnightArrivals) {
        return solveWithCandidates(lots, timeBudgetSeconds, maxIterations,
                cancelledFlightId, candidateMap, overnightArrivals, null);
    }

    public WorkingSolution solveWithCandidates(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            int maxIterations,
            String cancelledFlightId,
            Map<String, List<RoutePlan>> candidateMap,
            List<WorkingSolution.OvernightArrival> overnightArrivals,
            WorkingSolution baseSolution) {

        if (timeBudgetSeconds <= 0 && maxIterations <= 0) {
            throw new IllegalArgumentException(
                    "ALNS requires a time limit, an iteration limit, or both.");
        }

        WorkingSolution current = seedGreedy(lots, candidateMap, overnightArrivals, baseSolution);
        WorkingSolution best    = current.copy();
        double currentScore     = evaluator.solutionScore(lots, current);
        double bestScore        = currentScore;
        double temperature      = 50.0;

        long deadline = timeBudgetSeconds > 0
                ? System.currentTimeMillis() + timeBudgetSeconds * 1000L
                : Long.MAX_VALUE;
        int iterations = 0;

        while (System.currentTimeMillis() < deadline
                && (maxIterations <= 0 || iterations < maxIterations)) {
            iterations++;

            String destroyOp = pickWeighted(destroyWeights);
            String repairOp  = pickWeighted(repairWeights);

            WorkingSolution  trial   = current.copy();
            List<BaggageLot> removed = destroy(destroyOp, lots, trial, cancelledFlightId);
            repair(repairOp, removed, candidateMap, trial);

            double  trialScore = evaluator.solutionScore(lots, trial);
            boolean accepted   = trialScore < currentScore
                    || random.nextDouble() < Math.exp(
                            (currentScore - trialScore) / Math.max(0.001, temperature));

            if (accepted) {
                current      = trial;
                currentScore = trialScore;
                reward(destroyWeights, destroyOp, 0.3);
                reward(repairWeights,  repairOp,  0.3);
            }

            if (trialScore < bestScore) {
                best      = trial.copy();
                bestScore = trialScore;
                reward(destroyWeights, destroyOp, 0.8);
                reward(repairWeights,  repairOp,  0.8);
            }

            temperature *= 0.995;
            decayWeights(destroyWeights);
            decayWeights(repairWeights);
        }

        return best;
    }

    /**
     * Sobrecarga sin overnight (primer día o llamadas internas).
     */
    public WorkingSolution solveWithCandidates(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            String cancelledFlightId,
            Map<String, List<RoutePlan>> candidateMap) {
        return solveWithCandidates(lots, timeBudgetSeconds, cancelledFlightId,
                candidateMap, Collections.emptyList());
    }

    public WorkingSolution solveWithCandidates(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            int maxIterations,
            String cancelledFlightId,
            Map<String, List<RoutePlan>> candidateMap) {
        return solveWithCandidates(lots, timeBudgetSeconds, maxIterations,
                cancelledFlightId, candidateMap, Collections.emptyList());
    }

    /**
     * Resuelve calculando candidatos internamente.
     */
    public WorkingSolution solve(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            String cancelledFlightId) {
        return solveWithCandidates(lots, timeBudgetSeconds, cancelledFlightId,
                buildCandidateMap(lots), Collections.emptyList());
    }

    public WorkingSolution solve(
            List<BaggageLot> lots,
            int timeBudgetSeconds,
            int maxIterations,
            String cancelledFlightId) {
        return solveWithCandidates(lots, timeBudgetSeconds, maxIterations,
                cancelledFlightId, buildCandidateMap(lots), Collections.emptyList());
    }

    /**
     * Precalcula los candidatos para una lista de lotes.
     */
    public Map<String, List<RoutePlan>> buildCandidateMap(List<BaggageLot> lots) {
        Map<String, List<RoutePlan>> candidateMap = new HashMap<>();
        for (BaggageLot lot : lots) {
            List<RoutePlan> candidates = evaluator.enumerateCandidates(lot);
            if (candidates.size() > MAX_CANDIDATES) {
                candidates = new ArrayList<>(candidates.subList(0, MAX_CANDIDATES));
            }
            candidateMap.put(lot.getId(), candidates);
        }
        return candidateMap;
    }

    // ── inicialización greedy ────────────────────────────────────────────────

    /**
     * Construye la solución semilla greedy.
     * Inyecta los overnight arrivals en el WorkingSolution inicial ANTES de
     * asignar cualquier lote del día, de forma que canAssign() ya ve la
     * ocupación de almacén procedente de vuelos del día anterior.
     */
    private WorkingSolution seedGreedy(
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap,
            List<WorkingSolution.OvernightArrival> overnightArrivals) {
        return seedGreedy(lots, candidateMap, overnightArrivals, null);
    }

    private WorkingSolution seedGreedy(
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap,
            List<WorkingSolution.OvernightArrival> overnightArrivals,
            WorkingSolution baseSolution) {

        WorkingSolution seed = baseSolution == null
                ? new WorkingSolution(context)
                : baseSolution.copy();

        // Inyectar llegadas overnight: cada grupo en su minuto real (rebased)
        seed.injectOvernightArrivals(overnightArrivals);

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

    // ── destroy ──────────────────────────────────────────────────────────────

    private List<BaggageLot> destroy(
            String destroyOp,
            List<BaggageLot> lots,
            WorkingSolution solution,
            String cancelledFlightId) {

        List<BaggageLot> ordered = new ArrayList<>(lots);
        int removeCount = Math.min(MAX_DESTROY_COUNT,
                          Math.max(1, (int) Math.ceil(lots.size() * DESTROY_RATIO)));

        if ("worstDestroy".equals(destroyOp)) {
            ordered.sort((a, b) -> {
                double sa = solution.getPlan(a.getId()) == null
                        ? Double.MAX_VALUE : solution.getPlan(a.getId()).getScore();
                double sb = solution.getPlan(b.getId()) == null
                        ? Double.MAX_VALUE : solution.getPlan(b.getId()).getScore();
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
            Collections.shuffle(ordered, random);
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

    // ── repair ───────────────────────────────────────────────────────────────

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
            BaggageLot bestLot    = null;
            RoutePlan  bestPlan   = null;
            double     bestRegret = -1.0;

            for (BaggageLot lot : pending) {
                List<RoutePlan> feasible = new ArrayList<>();
                for (RoutePlan candidate : candidateMap.getOrDefault(lot.getId(), List.of())) {
                    if (solution.canAssign(lot, candidate)) feasible.add(candidate);
                }
                if (feasible.isEmpty()) continue;

                feasible.sort(Comparator.comparingDouble(RoutePlan::getScore));
                double first  = feasible.get(0).getScore();
                double second = feasible.size() > 1
                        ? feasible.get(1).getScore() : first + 100.0;
                double regret = second - first;

                if (regret > bestRegret) {
                    bestRegret = regret;
                    bestLot    = lot;
                    bestPlan   = feasible.get(0);
                }
            }

            if (bestLot == null) break;
            solution.assign(bestLot, bestPlan);
            pending.remove(bestLot);
        }
    }

    // ── selección ponderada de operadores ────────────────────────────────────

    private String pickWeighted(Map<String, Double> weights) {
        double total     = weights.values().stream().mapToDouble(Double::doubleValue).sum();
        double threshold = random.nextDouble() * total;
        double acc       = 0.0;
        for (Map.Entry<String, Double> entry : weights.entrySet()) {
            acc += entry.getValue();
            if (acc >= threshold) return entry.getKey();
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