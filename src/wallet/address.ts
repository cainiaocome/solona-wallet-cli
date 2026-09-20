import { address, isAddress, type Address } from "@solana/kit";
import { InvalidAddressError } from "../errors/errors.js";

export function parseAddress(value: string): Address {
  if (!isAddress(value)) throw new InvalidAddressError(value);
  return address(value);
}
