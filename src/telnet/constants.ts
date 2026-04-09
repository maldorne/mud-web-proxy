// Telnet protocol constants

// Commands
export const IAC = 255;
export const SB = 250;
export const SE = 240;
export const WILL = 251;
export const WONT = 252;
export const DO = 253;
export const DONT = 254;

// Options
export const ECHO = 1;
export const SGA = 3;
export const TTYPE = 24;
export const NAWS = 31;
export const NEW_ENVIRON = 39;
export const CHARSET = 42;
export const MSDP = 69;
export const MCCP2 = 86;
export const MXP = 91;
export const ATCP = 200;
export const GMCP = 201;

// Sub-negotiation values
export const IS = 0;
export const REQUEST = 1;
export const ACCEPTED = 2;
export const VAR = 1;
export const ESC = 33;

// MSDP sub-values
export const MSDP_VAR = 1;
export const MSDP_VAL = 2;

// Pre-built responses
export const WILL_TTYPE = Buffer.from([IAC, WILL, TTYPE]);
export const WILL_GMCP = Buffer.from([IAC, WILL, GMCP]);
export const DO_GMCP = Buffer.from([IAC, DO, GMCP]);
export const DO_MCCP = Buffer.from([IAC, DO, MCCP2]);
export const DO_MSDP = Buffer.from([IAC, DO, MSDP]);
export const WILL_CHARSET = Buffer.from([IAC, WILL, CHARSET]);
export const WILL_NEW = Buffer.from([IAC, WILL, NEW_ENVIRON]);
export const WONT_NAWS = Buffer.from([IAC, WONT, NAWS]);

export const ACCEPT_UTF8 = Buffer.from([
  IAC, SB, ACCEPTED, 34, 85, 84, 70, 45, 56, 34, IAC, SE,
]);

export const WILL_UTF8 = Buffer.from([
  IAC, SB, CHARSET, ACCEPTED, 85, 84, 70, 45, 56, IAC, SE,
]);
