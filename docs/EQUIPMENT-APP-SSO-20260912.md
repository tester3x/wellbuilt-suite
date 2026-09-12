# General Equipment access

The ordinary Equipment card now opens wbequipment://app-start with no identity
parameters. Equipment generates its own PKCE attempt and asks Suite at the new
equipment-access route. Suite waits for verified auth readiness, compares its
local account to live SDK claims, issues the server app-access code and returns
only code/state to the fixed Equipment callback. It checks the current identity
again before delivery and tracks Equipment for matching-account cascade logout.
No shift start, inspection completion, or invented binding is part of this flow.

83 DVIR/gate tests pass including the actual new route in a mocked runtime:
pending readiness and wrong owner issue nothing; accepted bridge sends no shift
or identity in either request URI. Android export passes. Phone verification and
the replacement build are pending. Existing required-inspection card routing is
unchanged; the new route supplies the ordinary browsing branch only.
