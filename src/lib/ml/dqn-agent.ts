/**
 * DQN Agent for V2G Optimization
 *
 * Deep Q-Network implementation using TensorFlow.js
 * Learns optimal charge/discharge policy to maximize multi-objective reward
 */

import * as tf from '@tensorflow/tfjs'
import { STATE_SIZE, ACTION_SIZE, ReplayBuffer, TrainingDataPoint } from './preprocessing'

export interface DQNConfig {
    stateSize: number
    actionSize: number
    hiddenLayers: number[]
    learningRate: number
    gamma: number           // Discount factor
    epsilon: number         // Exploration rate
    epsilonMin: number
    epsilonDecay: number
    batchSize: number
    targetUpdateFreq: number
}

const DEFAULT_CONFIG: DQNConfig = {
    stateSize: STATE_SIZE,
    actionSize: ACTION_SIZE,
    hiddenLayers: [128, 64, 32],
    learningRate: 0.001,
    gamma: 0.95,
    epsilon: 1.0,
    epsilonMin: 0.01,
    epsilonDecay: 0.995,
    batchSize: 64,
    targetUpdateFreq: 100
}

export class DQNAgent {
    private config: DQNConfig
    private model: tf.LayersModel
    private targetModel: tf.LayersModel
    private optimizer: tf.Optimizer
    private replayBuffer: ReplayBuffer
    private trainStep: number = 0

    constructor(config: Partial<DQNConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.model = this.buildModel()
        this.targetModel = this.buildModel()
        this.optimizer = tf.train.adam(this.config.learningRate)
        this.replayBuffer = new ReplayBuffer()

        // Initialize target model with same weights
        this.updateTargetModel()
    }

    /**
     * Build the Q-network architecture
     */
    private buildModel(): tf.LayersModel {
        const model = tf.sequential()

        // Input layer
        model.add(tf.layers.dense({
            units: this.config.hiddenLayers[0],
            activation: 'relu',
            inputShape: [this.config.stateSize],
            kernelInitializer: 'heNormal'
        }))

        // Hidden layers
        for (let i = 1; i < this.config.hiddenLayers.length; i++) {
            model.add(tf.layers.dense({
                units: this.config.hiddenLayers[i],
                activation: 'relu',
                kernelInitializer: 'heNormal'
            }))
            // Dropout for regularization
            model.add(tf.layers.dropout({ rate: 0.1 }))
        }

        // Output layer - Q-values for each action
        model.add(tf.layers.dense({
            units: this.config.actionSize,
            activation: 'linear',
            kernelInitializer: 'heNormal'
        }))

        return model
    }

    /**
     * Copy weights from main model to target model
     */
    updateTargetModel(): void {
        const weights = this.model.getWeights()
        this.targetModel.setWeights(weights)
    }

    /**
     * Select action using epsilon-greedy policy
     */
    selectAction(state: number[], training: boolean = true): number {
        if (training && Math.random() < this.config.epsilon) {
            // Random action (exploration)
            return Math.floor(Math.random() * this.config.actionSize)
        }

        // Greedy action (exploitation)
        const stateTensor = tf.tensor2d([state])
        const qValues = this.model.predict(stateTensor) as tf.Tensor
        const action = qValues.argMax(1).dataSync()[0]

        stateTensor.dispose()
        qValues.dispose()

        return action
    }

    /**
     * Get Q-values for all actions given a state
     */
    getQValues(state: number[]): number[] {
        const stateTensor = tf.tensor2d([state])
        const qValues = this.model.predict(stateTensor) as tf.Tensor
        const values = Array.from(qValues.dataSync())

        stateTensor.dispose()
        qValues.dispose()

        return values
    }

    /**
     * Store experience in replay buffer
     */
    remember(experience: TrainingDataPoint): void {
        this.replayBuffer.add(experience)
    }

    /**
     * Train the network on a batch from replay buffer
     */
    async train(): Promise<number> {
        if (this.replayBuffer.size < this.config.batchSize) {
            return 0
        }

        const batch = this.replayBuffer.sample(this.config.batchSize)

        // Prepare tensors
        const states = tf.tensor2d(batch.map(e => e.state))
        const nextStates = tf.tensor2d(batch.map(e => e.nextState))
        const actions = batch.map(e => e.action)
        const rewards = batch.map(e => e.reward)
        const dones = batch.map(e => e.done ? 1 : 0)

        // Calculate target Q-values using Double DQN
        const nextQValues = this.model.predict(nextStates) as tf.Tensor
        const nextTargetQValues = this.targetModel.predict(nextStates) as tf.Tensor

        const nextActions = nextQValues.argMax(1).dataSync()
        const nextTargetQ = nextTargetQValues.dataSync()

        // Compute TD targets
        const targets = await (this.model.predict(states) as tf.Tensor).array() as number[][]

        for (let i = 0; i < batch.length; i++) {
            const nextQ = nextTargetQ[nextActions[i] + i * this.config.actionSize]
            const target = rewards[i] + (1 - dones[i]) * this.config.gamma * nextQ
            targets[i][actions[i]] = target
        }

        const targetTensor = tf.tensor2d(targets)

        // Train step
        const loss = await this.trainStep_internal(states, targetTensor)

        // Cleanup
        states.dispose()
        nextStates.dispose()
        nextQValues.dispose()
        nextTargetQValues.dispose()
        targetTensor.dispose()

        this.trainStep++

        // Update target network periodically
        if (this.trainStep % this.config.targetUpdateFreq === 0) {
            this.updateTargetModel()
        }

        // Decay epsilon
        if (this.config.epsilon > this.config.epsilonMin) {
            this.config.epsilon *= this.config.epsilonDecay
        }

        return loss
    }

    /**
     * Internal training step with gradient descent
     */
    private async trainStep_internal(states: tf.Tensor, targets: tf.Tensor): Promise<number> {
        let lossValue = 0

        const loss = () => {
            const predictions = this.model.apply(states, { training: true }) as tf.Tensor
            const mse = tf.losses.meanSquaredError(targets, predictions)
            lossValue = mse.dataSync()[0]
            return mse as tf.Scalar
        }

        // Get trainable weights as Variable[] for the optimizer
        const trainableVars = this.model.trainableWeights.map(w => w.read() as tf.Variable)
        this.optimizer.minimize(loss, true, trainableVars)

        return lossValue
    }

    /**
     * Get current exploration rate
     */
    getEpsilon(): number {
        return this.config.epsilon
    }

    /**
     * Set exploration rate (useful for evaluation)
     */
    setEpsilon(epsilon: number): void {
        this.config.epsilon = epsilon
    }

    /**
     * Save model to file
     */
    async saveModel(path: string): Promise<void> {
        await this.model.save(`file://${path}`)
        console.log(`Model saved to ${path}`)
    }

    /**
     * Load model from file
     */
    async loadModel(path: string): Promise<void> {
        this.model = await tf.loadLayersModel(`file://${path}/model.json`)
        this.updateTargetModel()
        console.log(`Model loaded from ${path}`)
    }

    /**
     * Get model summary
     */
    summary(): void {
        this.model.summary()
    }

    /**
     * Get training statistics
     */
    getStats(): {
        trainSteps: number
        epsilon: number
        bufferSize: number
    } {
        return {
            trainSteps: this.trainStep,
            epsilon: this.config.epsilon,
            bufferSize: this.replayBuffer.size
        }
    }

    /**
     * Dispose of tensors
     */
    dispose(): void {
        this.model.dispose()
        this.targetModel.dispose()
    }
}

/**
 * Factory function for creating pre-configured agents
 */
export function createV2GAgent(mode: 'training' | 'evaluation' = 'training'): DQNAgent {
    const config: Partial<DQNConfig> = mode === 'evaluation'
        ? { epsilon: 0, epsilonMin: 0, epsilonDecay: 1 }
        : {}

    return new DQNAgent(config)
}
