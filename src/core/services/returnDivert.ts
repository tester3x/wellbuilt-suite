// Pure guard for the return-to-yard divert ("Back to Work" when a new job
// arrives while heading to The Yard). Kept RN/expo-free so the invariant is
// unit-testable without rendering AuthContext.
//
// A divert (abandonReturn) exits the returning-to-yard state WITHOUT recording
// an arrival or closing the shift. It is valid ONLY while a return is actually
// in progress — never otherwise.
export function shouldDivertFromReturn(input: { hasUser: boolean; returningToYard: boolean }): boolean {
  return input.hasUser === true && input.returningToYard === true;
}
