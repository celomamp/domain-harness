import { readFileSync } from "node:fs";
import { z } from "zod";
export const uses = [readFileSync, z];
