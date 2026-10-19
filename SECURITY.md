# Security policy

## Supported versions

Only the latest release of the Zonneplan integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a security
problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-zonneplan](https://github.com/prohand/gladys-zonneplan/security), then
**Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only asks
the maintainers for a private contact, without any detail of the problem, and send
the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, e-mail addresses and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular how the Zonneplan tokens are obtained, stored (`/data`, owner-only)
and sent.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), and
Zonneplan, its app and its API (report to Zonneplan).

## Good practices for users

- The integration signs in with a one-time code e-mailed by Zonneplan: never
  share that code, and never type it anywhere else than in Gladys.
- "Sign out" in the Configuration screen deletes the tokens from Gladys. You can
  also end the session from the Zonneplan app.
- Keep Gladys and the integration up to date.
