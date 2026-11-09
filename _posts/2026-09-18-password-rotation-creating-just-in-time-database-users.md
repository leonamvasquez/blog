---
title: "Password Rotation: Creating Just-in-Time Database Users"
description: "How to use Vault's database secrets engine to create users on demand in PostgreSQL: connection configuration, rotating the administrative password, dynamic roles, static roles, and the impact on applications."
date: 2026-09-18 19:00:00 +0000
lang: en
permalink: /en/posts/password-rotation-creating-just-in-time-database-users/
categories: [DevSecOps, Security, Vault]
tags: [Vault, PostgreSQL, Database, Dynamic Credentials, DevSecOps]
icons: [vault]
---

## Introduction

Almost every production database has a user called some variation of `app_user`. It was created in the first version of the system, with a password that today is in the configuration of four different services, in two pipelines, and in the memory of a few engineers who no longer work at the company.

Nobody changes that password. Changing it would require updating all those places at the same time, and nobody is sure which they are.

Vault's database secrets engine solves this in a way that at first seems strange: instead of protecting `app_user` better, it makes each application instance have its own user, created when it starts and removed when the time is up.

## What Just-in-Time Means

The expression describes the moment access comes into existence. Instead of a permanent user waiting to be used, the user is created at the instant of the request, with the permissions that consumer needs and with an expiry.

Three consequences follow. Each credential is unique, so the database's audit logs start identifying which instance performed each operation. Each credential expires, so a leak has limited duration. And there is no shared password to rotate, because no password lasts long enough to need it.

## Configuring the Connection

The first step is to enable the engine and tell Vault how to connect to the database:

```bash
vault secrets enable database

vault write database/config/payments-db \
    plugin_name="postgresql-database-plugin" \
    allowed_roles="payments-read,payments-write" \
    connection_url="postgresql://{{username}}:{{password}}@db.internal:5432/payments" \
    username="vault_admin" \
    password="initial-password" \
    password_authentication="scram-sha-256"
```

The placeholders in the connection URL are filled in by Vault itself with the username and password provided. The `allowed_roles` attribute limits which roles can use this connection, which prevents a mistakenly configured role from generating credentials in a database it should not.

The user configured here needs permission to create and remove other users. It should be dedicated to Vault, not the superuser some administrator uses day to day.

## Taking the Administrative Password Out of Circulation

The password given in the configuration was typed by someone, shows up in the terminal history, and may be in a personal password manager. The next step fixes that:

```bash
vault write -f database/rotate-root/payments-db
```

Vault changes the administrative user's password to one only it knows. From that moment on, the only way to administer users in that database through this account is through Vault.

This operation is irreversible in the practical sense: nobody can recover the new password. If direct administrative access is needed for emergencies, it has to be arranged through another account before the rotation.

## The Dynamic Role

The role defines what happens when someone asks for a credential. The core is the creation SQL:

```bash
vault write database/roles/payments-read \
    db_name="payments-db" \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"
```

The three placeholders are filled in on each request: a generated username, a generated password, and the expiration date.

The validity clause in PostgreSQL itself deserves emphasis. It works as a second barrier, independent of Vault. If, for any reason, Vault fails to remove the user at the end of the lease, the database itself refuses the login after the given date.

The permissions granted in the SQL are the right place to apply the principle of least privilege. A read role grants only read, a write role grants only what the application needs to write. Since creating roles is cheap, there is no reason for a single role with all the permissions.

## Obtaining and Managing Credentials

The consumer asks for a credential by reading the role's path:

```bash
vault read database/creds/payments-read
```

The response brings a user, a password, and a lease with the default duration of one hour, renewable up to the maximum limit.

```bash
vault lease renew database/creds/payments-read/<lease_id>
vault lease revoke database/creds/payments-read/<lease_id>
```

On revocation or expiry, Vault removes the user from the database.

There is one case where this removal fails, and it shows up often in applications that create objects. If the dynamic user created a table, it becomes the owner, and PostgreSQL does not allow removing a user who owns objects. The solution is to have the dynamic users belong to a group role that owns the objects, and create tables under that role, instead of being the owners themselves.

## When the User Needs to Exist

Not every system accepts changing users on every connection. Legacy applications, third-party tools, and integrations that depend on a fixed name expect a permanent user.

For those cases there are **static roles**. Vault takes over managing the password of an existing user, changing it periodically:

```bash
vault write database/static-roles/legacy-integration \
    db_name="payments-db" \
    username="legacy_integration" \
    rotation_period="24h"
```

```bash
vault read database/static-creds/legacy-integration
```

The user stays the same, but the password changes each cycle, and whoever needs it fetches it from Vault instead of keeping it stored.

This model has a fragile point: any password change made outside Vault puts the two sides out of sync. Vault keeps handing out the password it believes is correct, and connections fail until someone fixes it manually in the database. Once a user is managed by Vault, every change has to go through it.

In the Enterprise edition there is also a variant that does away with the administrative account, in which each user manages its own rotation.

## The Impact on the Application

Dynamic credentials change what the application has to do, and this is the point that most slows adoption.

An application that reads the password once at startup and keeps a connection pool forever does not work well with a credential that expires in an hour. It needs to renew the lease while active, or fetch a new credential and recycle the pool's connections before the previous one expires.

There are ways to take this responsibility out of the code. Vault Agent, running alongside the application, takes care of authentication, renewal, and writing the credentials to a file, and the application only needs to re-read that file when it changes. Database access libraries in several ecosystems also offer direct integration.

The conversation with the application team should happen before adoption, not after the first broken connection pool in production.

## Conclusion

The shared `app_user` persists because solving its problem seemed to require a coordinated rotation nobody could carry out safely. Just-in-time credentials get around the difficulty instead of facing it: there is no coordinated rotation when there is no shared password.

The cost of the change lies in the application, which has to accept credentials with an expiry. That cost is real, and it is what determines the pace of adoption.

In return, the database gains something it has rarely had: a record in which each connection points to an identifiable origin, and in which a user found in the logs of suspicious activity can be tied to an instance, a time, and a specific lease. For anyone who has had to investigate an incident in a database where everything happened under the same `app_user`, the difference needs no argument.
