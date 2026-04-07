import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const GatewayAttachmentSourceSchema = Type.Object(
  {
    type: Type.Optional(Type.String()),
    media_type: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const GatewayAttachmentInputSchema = Type.Object(
  {
    type: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
    fileName: Type.Optional(Type.String()),
    fileRef: Type.Optional(NonEmptyString),
    content: Type.Optional(Type.Unknown()),
    source: Type.Optional(GatewayAttachmentSourceSchema),
  },
  { additionalProperties: false },
);
