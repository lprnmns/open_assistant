import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const UiActionRiskSchema = Type.String({
  enum: ["low", "medium", "high"],
});

const UiActionTimeoutMsSchema = Type.Optional(Type.Integer({ minimum: 0, maximum: 120_000 }));

const OpenAppActionSchema = Type.Object(
  {
    action: Type.Literal("open_app"),
    target: NonEmptyString,
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const ClickByIdActionSchema = Type.Object(
  {
    action: Type.Literal("click_node"),
    id: NonEmptyString,
    content_desc: Type.Optional(NonEmptyString),
    text: Type.Optional(NonEmptyString),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const ClickByContentDescriptionActionSchema = Type.Object(
  {
    action: Type.Literal("click_node"),
    id: Type.Optional(NonEmptyString),
    content_desc: NonEmptyString,
    text: Type.Optional(NonEmptyString),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const ClickByTextActionSchema = Type.Object(
  {
    action: Type.Literal("click_node"),
    id: Type.Optional(NonEmptyString),
    content_desc: Type.Optional(NonEmptyString),
    text: NonEmptyString,
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

export const ClickNodeActionSchema = Type.Union([
  ClickByIdActionSchema,
  ClickByContentDescriptionActionSchema,
  ClickByTextActionSchema,
]);

const TypeTextActionSchema = Type.Object(
  {
    action: Type.Literal("type_text"),
    text: NonEmptyString,
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const WaitForNodeByIdActionSchema = Type.Object(
  {
    action: Type.Literal("wait_for_node"),
    id: NonEmptyString,
    content_desc: Type.Optional(NonEmptyString),
    text: Type.Optional(NonEmptyString),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const WaitForNodeByContentDescriptionActionSchema = Type.Object(
  {
    action: Type.Literal("wait_for_node"),
    id: Type.Optional(NonEmptyString),
    content_desc: NonEmptyString,
    text: Type.Optional(NonEmptyString),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const WaitForNodeByTextActionSchema = Type.Object(
  {
    action: Type.Literal("wait_for_node"),
    id: Type.Optional(NonEmptyString),
    content_desc: Type.Optional(NonEmptyString),
    text: NonEmptyString,
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

export const WaitForNodeActionSchema = Type.Union([
  WaitForNodeByIdActionSchema,
  WaitForNodeByContentDescriptionActionSchema,
  WaitForNodeByTextActionSchema,
]);

const ScrollActionSchema = Type.Object(
  {
    action: Type.Literal("scroll"),
    direction: Type.String({ enum: ["up", "down", "left", "right"] }),
    amount: Type.Optional(Type.String({ enum: ["small", "medium", "large"] })),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const BackActionSchema = Type.Object(
  {
    action: Type.Literal("back"),
    timeoutMs: UiActionTimeoutMsSchema,
  },
  { additionalProperties: false },
);

const ObserveScreenActionSchema = Type.Object(
  {
    action: Type.Literal("observe_screen"),
  },
  { additionalProperties: false },
);

const RequestConfirmationActionSchema = Type.Object(
  {
    action: Type.Literal("request_confirmation"),
    prompt: NonEmptyString,
    risk: Type.Optional(UiActionRiskSchema),
  },
  { additionalProperties: false },
);

export const UiActionSchema = Type.Union([
  OpenAppActionSchema,
  ClickNodeActionSchema,
  TypeTextActionSchema,
  WaitForNodeActionSchema,
  ScrollActionSchema,
  BackActionSchema,
  ObserveScreenActionSchema,
  RequestConfirmationActionSchema,
]);

export const UiActionPlanSchema = Type.Object(
  {
    kind: Type.Literal("ui_actions"),
    planId: NonEmptyString,
    targetDeviceId: NonEmptyString,
    idempotencyKey: NonEmptyString,
    risk: UiActionRiskSchema,
    requiresConfirmation: Type.Boolean(),
    actions: Type.Array(UiActionSchema, { minItems: 1, maxItems: 50 }),
    expiresAt: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const UiTaskRunParamsSchema = Type.Object(
  {
    objective: NonEmptyString,
    nodeId: Type.Optional(NonEmptyString),
    idempotencyKey: Type.Optional(NonEmptyString),
    risk: Type.Optional(UiActionRiskSchema),
    requiresConfirmation: Type.Optional(Type.Boolean()),
    maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    dryRun: Type.Optional(Type.Boolean()),
    actions: Type.Optional(Type.Array(UiActionSchema, { minItems: 1, maxItems: 20 })),
  },
  { additionalProperties: false },
);
