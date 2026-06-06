// domain types
export type {
  Topic,
  Message,
  MessagePart,
  Artifact,
  CronJob,
  CronRun,
  Interaction,
  UsageRecord,
  TodoItem,
  ProgrammingSpec,
  GeneralSpec,
  ArtifactRef,
} from './domain'

// PI events
export {
  piEventSchema,
  partDeltaSchema,
  textDeltaSchema,
  thinkingDeltaSchema,
  toolInputDeltaSchema,
  messageStartPayloadSchema,
  messageDeltaPayloadSchema,
  messageEndPayloadSchema,
  toolCallPayloadSchema,
  toolResultPayloadSchema,
  fileDiffPayloadSchema,
  todoUpdatePayloadSchema,
  planUpdatePayloadSchema,
  interactionRequestPayloadSchema,
  agentStatusPayloadSchema,
  agentProgressPayloadSchema,
  cronCreatedPayloadSchema,
  cronTriggeredPayloadSchema,
  usageDeltaPayloadSchema,
  artifactCreatedPayloadSchema,
  errorPayloadSchema,
  sessionHealthPayloadSchema,
  cronRunCompletedPayloadSchema,
  keepalivePayloadSchema,
  todoItemSchema,
} from './pi-events'

export type {
  PIEvent,
  PIPayload,
  PartDelta,
  TextDelta,
  ThinkingDelta,
  ToolInputDelta,
  MessageStartPayload,
  MessageDeltaPayload,
  MessageEndPayload,
  ToolCallPayload,
  ToolResultPayload,
  FileDiffPayload,
  TodoUpdatePayload,
  PlanUpdatePayload,
  InteractionRequestPayload,
  AgentStatusPayload,
  AgentProgressPayload,
  CronCreatedPayload,
  CronTriggeredPayload,
  UsageDeltaPayload,
  ArtifactCreatedPayload,
  ErrorPayload,
  SessionHealthPayload,
  CronRunCompletedPayload,
  KeepalivePayload,
  TodoItemZ,
} from './pi-events'

// PI RPC
export {
  programmingSpecSchema,
  generalSpecSchema,
  createSessionParamsSchema,
  createSessionResultSchema,
  attachSessionParamsSchema,
  attachSessionResultSchema,
  recreateSessionParamsSchema,
  recreateSessionResultSchema,
  detachExtensionParamsSchema,
  detachExtensionResultSchema,
  destroySessionParamsSchema,
  destroySessionResultSchema,
  abortSessionParamsSchema,
  abortSessionResultSchema,
  sendUserMessageParamsSchema,
  sendUserMessageResultSchema,
  resolveInteractionParamsSchema,
  resolveInteractionResultSchema,
  createCronParamsSchema,
  createCronResultSchema,
  listCronsParamsSchema,
  listCronsResultSchema,
  listCronRunsParamsSchema,
  listCronRunsResultSchema,
  updateCronParamsSchema,
  updateCronResultSchema,
  pauseCronParamsSchema,
  pauseCronResultSchema,
  resumeCronParamsSchema,
  resumeCronResultSchema,
  deleteCronParamsSchema,
  deleteCronResultSchema,
  setSessionModelParamsSchema,
  setSessionModelResultSchema,
  getUsageParamsSchema,
  getUsageResultSchema,
  runMcpCommandParamsSchema,
  runMcpCommandResultSchema,
  mcpServerSpecSchema,
  providerConfigSchema,
  listProviderConfigsParamsSchema,
  listProviderConfigsResultSchema,
  addProviderConfigParamsSchema,
  addProviderConfigResultSchema,
  updateProviderConfigParamsSchema,
  updateProviderConfigResultSchema,
  removeProviderConfigParamsSchema,
  removeProviderConfigResultSchema,
  switchSessionProviderParamsSchema,
  switchSessionProviderResultSchema,
  rpcRequestSchema,
  rpcResultSchema,
  rpcErrorSchema,
} from './pi-rpc'

export type {
  PiRpcMethod,
  ArtifactRefRpc,
  ProgrammingSpecRpc,
  GeneralSpecRpc,
  CreateSessionParams,
  CreateSessionResult,
  AttachSessionParams,
  AttachSessionResult,
  RecreateSessionParams,
  RecreateSessionResult,
  DetachExtensionParams,
  DetachExtensionResult,
  DestroySessionParams,
  DestroySessionResult,
  AbortSessionParams,
  AbortSessionResult,
  SendUserMessageParams,
  SendUserMessageResult,
  ResolveInteractionParams,
  ResolveInteractionResult,
  CreateCronParams,
  CreateCronResult,
  ListCronsParams,
  ListCronsResult,
  CronInfo,
  ListCronRunsParams,
  ListCronRunsResult,
  CronRunInfo,
  UpdateCronParams,
  UpdateCronResult,
  PauseCronParams,
  PauseCronResult,
  ResumeCronParams,
  ResumeCronResult,
  DeleteCronParams,
  DeleteCronResult,
  SetSessionModelParams,
  SetSessionModelResult,
  GetUsageParams,
  GetUsageResult,
  RunMcpCommandParams,
  RunMcpCommandResult,
  McpServerSpec,
  ProviderConfigRpc,
  ListProviderConfigsParams,
  ListProviderConfigsResult,
  AddProviderConfigParams,
  AddProviderConfigResult,
  UpdateProviderConfigParams,
  UpdateProviderConfigResult,
  RemoveProviderConfigParams,
  RemoveProviderConfigResult,
  SwitchSessionProviderParams,
  SwitchSessionProviderResult,
  RpcRequest,
  RpcResult,
  RpcError,
} from './pi-rpc'

// WS events
export {
  topicsListSchema,
  topicCreatedSchema,
  topicUpdatedSchema,
  topicDeletedSchema,
  messageStartSchema,
  messageDeltaSchema,
  messageEndSchema,
  messageDeliverySchema,
  toolCallSchema,
  toolResultSchema,
  fileDiffSchema,
  todoUpdateSchema,
  planUpdateSchema,
  interactionRequestSchema,
  agentStatusSchema,
  agentProgressSchema,
  cronListSchema,
  cronUpsertedSchema,
  cronTriggeredSchema,
  artifactAddedSchema,
  artifactDeletedSchema,
  artifactMovedSchema,
  artifactListSchema,
  artifactUploadReadySchema,
  artifactDownloadReadySchema,
  sopTemplateSummarySchema,
  sopTemplateListSchema,
  sopTemplateGeneratedSchema,
  usageSnapshotSchema,
  errorSchema,
  sessionHealthSchema,
  cronRunCompletedSchema,
  messagesHistorySchema,
  serverEventDataSchemas,
  topicCreateSchema,
  topicDeleteSchema,
  topicRenameSchema,
  topicDetachExtensionSchema,
  topicSetModelSchema,
  topicSetAttentionTargetSchema,
  userMessageSchema,
  userMessageRetrySchema,
  userActionSchema,
  cronPauseSchema,
  cronDeleteSchema,
  cronEditSchema,
  cronSyncSchema,
  artifactUploadInitSchema,
  artifactUploadCompleteSchema,
  artifactDownloadInitSchema,
  searchQuerySchema,
  topicResumeSchema,
  messagesLoadSchema,
  topicSelectSchema,
  topicSetPlanModeSchema,
  cronResumeSchema,
  mcpCommandSchema,
  mcpCommandResultSchema,
  mcpCommandErrorSchema,
  providerRpcSchema,
  providerRpcResultSchema,
  providerRpcErrorSchema,
  sopTemplateSaveSchema,
  sopTemplateDeleteSchema,
  sopTemplateGenerateSchema,
  clientEventDataSchemas,
} from './ws-events'

export type {
  ServerEvent,
  ClientEvent,
} from './ws-events'

// PI adapter constants & URL utilities
export {
  DEFAULT_PI_ADAPTER_URL,
  normalizePiWsUrl,
  piWsToHttp,
  piWsToHttpBase,
  buildPiWsUrl,
} from './pi-adapter'

// Frame
export {
  wsFrameSchema,
  encodeFrame,
  decodeFrame,
  createFrame,
} from './frame'

export type { WSFrame } from './frame'

// Attention shared pipeline
export type {
  EventKind,
  UserMessageKind,
  AssistantActionKind,
  RawEvent,
  AlignmentStatus,
  NodeStatus,
  TraceExchange,
  TraceNode,
  PlanItem,
  GoalAnchor,
} from './attention/types'

export {
  storeToRawEvents,
  extractGoalAnchor,
  classifyUserKind,
} from './attention/store-adapter'

export type {
  TodoSnapshotItem,
  StoreToRawEventsInput,
  AttentionInteraction,
} from './attention/store-adapter'

export {
  aggregate,
  groupExchanges,
  candidatesToLoadingNodes,
} from './attention/aggregator'

export type {
  CandidateNode,
  ExchangeGroup,
} from './attention/aggregator'

export {
  buildTrace,
  buildInterpretPrompt,
  candidateText,
  localSummary,
  makeInterpretKey,
  planInterpret,
} from './attention/orchestrator'

export type {
  InterpretResult as AttentionInterpretResult,
} from './attention/orchestrator'

export {
  tokenize,
  cosineSimilarity,
  computeGoalDistance,
  goalAlignmentToDistance,
  subGoalDistance,
  goalDistanceTone,
  goalDistanceColor,
} from './attention/goal-distance'

export type {
  GoalDistanceTone,
} from './attention/goal-distance'

export {
  governConversationTree,
} from './attention/conversation-tree'

export type {
  ConversationTreeNodeKind,
  ConversationRelation,
  CollapseReason,
  AggregationInfo,
  ConversationTreeNode,
  ConversationTree,
  ConversationTreeOptions,
} from './attention/conversation-tree'

export {
  buildMindMapProjection,
} from './attention/mind-map-projector'

export type {
  MindMapNodeKind,
  MindMapEdgeKind,
  MindMapNode,
  MindMapEdge,
  MindMapProjection,
} from './attention/mind-map-projector'

export {
  projectPlanGraph,
} from './attention/plan-projector'

export type {
  PlanGraphItem,
  PlanGraph,
} from './attention/plan-projector'
