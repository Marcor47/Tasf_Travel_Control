package com.tasf.planner.nsga;
 
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
 
public class NSGA2Planner {
    private final PlanningContext context;
    private final RouteEvaluator evaluator;
    private final Random random;
 
    public NSGA2Planner(PlanningContext context, long seed) {
        this.context = context;
        this.evaluator = new RouteEvaluator(context);
        this.random = new Random(seed);
    }
 
    public Result solve(
            List<BaggageLot> lots,
            int populationSize,
            int generations) {
        Map<String, List<RoutePlan>> candidateMap = new HashMap<>();
        for (BaggageLot lot : lots) {
            candidateMap.put(lot.getId(), evaluator.enumerateCandidates(lot));
        }
 
        List<Individual> population = new ArrayList<>();
        for (int i = 0; i < populationSize; i++) {
            population.add(randomIndividual(lots, candidateMap));
        }
        evaluatePopulation(population, lots, candidateMap);
 
        for (int generation = 0; generation < generations; generation++) {
            List<Individual> offspring = new ArrayList<>();
            while (offspring.size() < populationSize) {
                Individual p1 = tournament(population);
                Individual p2 = tournament(population);
                Individual child = crossover(p1, p2);
                mutate(child, candidateMap);
                offspring.add(child);
            }
            evaluatePopulation(offspring, lots, candidateMap);
 
            List<Individual> merged = new ArrayList<>(population);
            merged.addAll(offspring);
            population = nextGeneration(merged, populationSize);
        }
 
        List<List<Individual>> fronts = fastNonDominatedSort(population);
        List<WorkingSolution> paretoPlans = new ArrayList<>();
        for (Individual individual : fronts.get(0)) {
            paretoPlans.add(individual.decodedPlan.copy());
        }
        Individual compromise = chooseCompromise(fronts.get(0));
        return new Result(paretoPlans, compromise.decodedPlan.copy(), fronts.get(0));
    }
 
    private Individual randomIndividual(
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap) {
        Individual individual = new Individual();
        for (BaggageLot lot : lots) {
            List<RoutePlan> candidates = candidateMap.getOrDefault(lot.getId(), List.of());
            int gene = candidates.isEmpty()
                    ? -1
                    : random.nextInt(Math.max(1, Math.min(4, candidates.size())));
            individual.genes.put(lot.getId(), gene);
        }
        return individual;
    }
 
    private void evaluatePopulation(
            List<Individual> population,
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap) {
        for (Individual individual : population) {
            decodeAndEvaluate(individual, lots, candidateMap);
        }
        assignRanksAndCrowding(population);
    }
 
    private void decodeAndEvaluate(
            Individual individual,
            List<BaggageLot> lots,
            Map<String, List<RoutePlan>> candidateMap) {
        WorkingSolution solution = new WorkingSolution(context);
        List<BaggageLot> ordered = new ArrayList<>(lots);
        ordered.sort(Comparator
                .comparing(BaggageLot::isReplanningPriority).reversed()
                .thenComparingInt(BaggageLot::getDueHour));
 
        int unplanned = 0;
        double tardiness = 0.0;
        double transfersAndWait = 0.0;
 
        for (BaggageLot lot : ordered) {
            List<RoutePlan> candidates = candidateMap.getOrDefault(lot.getId(), List.of());
            Integer gene = individual.genes.getOrDefault(lot.getId(), -1);
            RoutePlan chosen = null;
 
            if (gene != null && gene >= 0 && gene < candidates.size()) {
                RoutePlan preferred = candidates.get(gene);
                if (solution.canAssign(lot, preferred)) {
                    chosen = preferred;
                }
            }
            if (chosen == null) {
                for (RoutePlan candidate : candidates) {
                    if (solution.canAssign(lot, candidate)) {
                        chosen = candidate;
                        break;
                    }
                }
            }
            if (chosen == null) {
                unplanned++;
            } else {
                solution.assign(lot, chosen);
                tardiness += chosen.getTardinessHours();
                transfersAndWait += chosen.transfers()
                        + (chosen.getTotalWaitingHours() / 24.0);
            }
        }
 
        double utilizationObjective = usedCapacityObjective(solution);
        individual.objectives = new double[] {
                tardiness + unplanned * 25.0,
                utilizationObjective,
                transfersAndWait + unplanned * 3.0
        };
        individual.decodedPlan = solution;
    }
 
    private double usedCapacityObjective(WorkingSolution solution) {
        int usedCapacity = 0;
        int offeredCapacity = 0;
        for (var flight : context.getFlights()) {
            int residual = solution.residualFor(flight.getId());
            if (residual < flight.getCapacity()) {
                offeredCapacity += flight.getCapacity();
                usedCapacity += flight.getCapacity() - residual;
            }
        }
        if (offeredCapacity == 0) {
            return 1.0;
        }
        return 1.0 - ((double) usedCapacity / offeredCapacity);
    }
 
    private Individual tournament(List<Individual> population) {
        Individual a = population.get(random.nextInt(population.size()));
        Individual b = population.get(random.nextInt(population.size()));
        if (a.rank != b.rank) {
            return a.rank < b.rank ? a : b;
        }
        return a.crowdingDistance >= b.crowdingDistance ? a : b;
    }
 
    private Individual crossover(Individual p1, Individual p2) {
        Individual child = new Individual();
        for (String geneKey : p1.genes.keySet()) {
            child.genes.put(
                    geneKey,
                    random.nextBoolean()
                            ? p1.genes.get(geneKey)
                            : p2.genes.getOrDefault(geneKey, p1.genes.get(geneKey)));
        }
        return child;
    }
 
    private void mutate(
            Individual child,
            Map<String, List<RoutePlan>> candidateMap) {
        for (Map.Entry<String, Integer> entry : child.genes.entrySet()) {
            if (random.nextDouble() < 0.10) {
                int size = candidateMap.getOrDefault(entry.getKey(), List.of()).size();
                entry.setValue(size == 0 ? -1 : random.nextInt(size));
            }
        }
    }
 
    private List<Individual> nextGeneration(
            List<Individual> merged,
            int populationSize) {
        List<List<Individual>> fronts = fastNonDominatedSort(merged);
        List<Individual> next = new ArrayList<>();
        int index = 0;
        while (index < fronts.size()
                && next.size() + fronts.get(index).size() <= populationSize) {
            calculateCrowding(fronts.get(index));
            next.addAll(fronts.get(index));
            index++;
        }
        if (index < fronts.size()) {
            List<Individual> lastFront = fronts.get(index);
            calculateCrowding(lastFront);
            lastFront.sort((a, b) -> Double.compare(
                    b.crowdingDistance, a.crowdingDistance));
            int remaining = populationSize - next.size();
            next.addAll(lastFront.subList(0, remaining));
        }
        assignRanksAndCrowding(next);
        return next;
    }
 
    private void assignRanksAndCrowding(List<Individual> population) {
        List<List<Individual>> fronts = fastNonDominatedSort(population);
        for (int i = 0; i < fronts.size(); i++) {
            for (Individual individual : fronts.get(i)) {
                individual.rank = i;
            }
            calculateCrowding(fronts.get(i));
        }
    }
 
    private List<List<Individual>> fastNonDominatedSort(List<Individual> population) {
        Map<Individual, List<Individual>> dominates = new HashMap<>();
        Map<Individual, Integer> dominatedCount = new HashMap<>();
        List<List<Individual>> fronts = new ArrayList<>();
        List<Individual> firstFront = new ArrayList<>();
 
        for (Individual p : population) {
            dominates.put(p, new ArrayList<>());
            dominatedCount.put(p, 0);
            for (Individual q : population) {
                if (p == q) {
                    continue;
                }
                if (dominates(p, q)) {
                    dominates.get(p).add(q);
                } else if (dominates(q, p)) {
                    dominatedCount.put(p, dominatedCount.get(p) + 1);
                }
            }
            if (dominatedCount.get(p) == 0) {
                firstFront.add(p);
            }
        }
        fronts.add(firstFront);
        int index = 0;
        while (index < fronts.size() && !fronts.get(index).isEmpty()) {
            List<Individual> nextFront = new ArrayList<>();
            for (Individual p : fronts.get(index)) {
                for (Individual q : dominates.get(p)) {
                    dominatedCount.put(q, dominatedCount.get(q) - 1);
                    if (dominatedCount.get(q) == 0) {
                        nextFront.add(q);
                    }
                }
            }
            index++;
            if (!nextFront.isEmpty()) {
                fronts.add(nextFront);
            }
        }
        return fronts;
    }
 
    private boolean dominates(Individual a, Individual b) {
        boolean strictlyBetter = false;
        for (int i = 0; i < a.objectives.length; i++) {
            if (a.objectives[i] > b.objectives[i]) {
                return false;
            }
            if (a.objectives[i] < b.objectives[i]) {
                strictlyBetter = true;
            }
        }
        return strictlyBetter;
    }
 
    private void calculateCrowding(List<Individual> front) {
        if (front.isEmpty()) {
            return;
        }
        for (Individual individual : front) {
            individual.crowdingDistance = 0.0;
        }
        int dimensions = front.get(0).objectives.length;
        for (int d = 0; d < dimensions; d++) {
            final int dimension = d;
            front.sort(Comparator.comparingDouble(i -> i.objectives[dimension]));
            front.get(0).crowdingDistance = Double.POSITIVE_INFINITY;
            front.get(front.size() - 1).crowdingDistance = Double.POSITIVE_INFINITY;
            double min = front.get(0).objectives[dimension];
            double max = front.get(front.size() - 1).objectives[dimension];
            if (max - min == 0.0) {
                continue;
            }
            for (int i = 1; i < front.size() - 1; i++) {
                double prev = front.get(i - 1).objectives[dimension];
                double next = front.get(i + 1).objectives[dimension];
                front.get(i).crowdingDistance += (next - prev) / (max - min);
            }
        }
    }
 
    private Individual chooseCompromise(List<Individual> front) {
        double[] mins = new double[3];
        double[] maxs = new double[3];
        java.util.Arrays.fill(mins, Double.POSITIVE_INFINITY);
        java.util.Arrays.fill(maxs, Double.NEGATIVE_INFINITY);
        for (Individual individual : front) {
            for (int i = 0; i < 3; i++) {
                mins[i] = Math.min(mins[i], individual.objectives[i]);
                maxs[i] = Math.max(maxs[i], individual.objectives[i]);
            }
        }
        return front.stream()
                .min(Comparator.comparingDouble(individual ->
                        normalizedSum(individual.objectives, mins, maxs)))
                .orElse(front.get(0));
    }
 
    private double normalizedSum(double[] values, double[] mins, double[] maxs) {
        double total = 0.0;
        for (int i = 0; i < values.length; i++) {
            if (maxs[i] - mins[i] == 0.0) {
                continue;
            }
            total += (values[i] - mins[i]) / (maxs[i] - mins[i]);
        }
        return total;
    }
 
    public static class Individual {
        Map<String, Integer> genes = new HashMap<>();
        double[] objectives = new double[] {0, 0, 0};
        int rank = Integer.MAX_VALUE;
        double crowdingDistance = 0.0;
        WorkingSolution decodedPlan;
    }
 
    public static class Result {
        private final List<WorkingSolution> paretoPlans;
        private final WorkingSolution compromisePlan;
        private final List<Individual> firstFront;
 
        public Result(
                List<WorkingSolution> paretoPlans,
                WorkingSolution compromisePlan,
                List<Individual> firstFront) {
            this.paretoPlans = paretoPlans;
            this.compromisePlan = compromisePlan;
            this.firstFront = firstFront;
        }
 
        public List<WorkingSolution> getParetoPlans() {
            return paretoPlans;
        }
 
        public WorkingSolution getCompromisePlan() {
            return compromisePlan;
        }
 
        public List<Individual> getFirstFront() {
            return firstFront;
        }
    }
}
