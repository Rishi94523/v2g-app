/**
 * ML Module Index
 *
 * Exports all ML-related functionality for V2G optimization
 */

// Preprocessing
export {
    stateToVector,
    indexToAction,
    actionToIndex,
    normalize,
    denormalize,
    generateEpisode,
    ReplayBuffer,
    STATE_SIZE,
    ACTION_SIZE,
    NORMALIZATION
} from './preprocessing'
export type { NormalizedState, TrainingDataPoint } from './preprocessing'

// DQN Agent
export { DQNAgent, createV2GAgent } from './dqn-agent'
export type { DQNConfig } from './dqn-agent'

// Environment
export { V2GEnvironment } from './environment'
export type { BatteryConfig, SimulationConfig, StepResult, EpisodeStats } from './environment'

// Experiments
export { ExperimentRunner, runComparisonExperiment } from './experiment'
export type { ExperimentConfig, ExperimentMetrics, ExperimentResults } from './experiment'
