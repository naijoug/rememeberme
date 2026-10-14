"""Prepare/finalize a DNS-01 certificate using an existing Caddy ACME account.

Run with the separate host certificate-tools environment. Never registers a new
ACME account, accepts new terms, or changes another site's certificate files.
"""
import argparse
import datetime
import json
import os
from pathlib import Path

from acme import challenges, client, errors, messages
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import josepy as jose


def connect(account_key):
    key = jose.JWK.load(Path(account_key).read_bytes())
    network = client.ClientNetwork(key, alg=jose.ES256 if isinstance(key, jose.JWKEC) else jose.RS256,
                                   user_agent="RememberMe-DNS-Certificate", timeout=25)
    directory = client.ClientV2.get_directory("https://acme-v02.api.letsencrypt.org/directory", network)
    api = client.ClientV2(directory, network)
    try:
        api.new_account(messages.NewRegistration(only_return_existing=True))
    except errors.ConflictError as conflict:
        network.account = messages.RegistrationResource(uri=conflict.location, body=messages.Registration())
    return api, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "finalize"])
    parser.add_argument("state_directory")
    parser.add_argument("--hostname", default="rememberme.couplelabs.cn")
    args = parser.parse_args()
    if args.hostname != "rememberme.couplelabs.cn":
        raise SystemExit("This host procedure is scoped to rememberme.couplelabs.cn")
    os.umask(0o077)
    state_directory = Path(args.state_directory)
    state_file = state_directory / "request.json"
    if args.mode == "prepare":
        state_directory.mkdir(mode=0o700)
        accounts = list(Path("/var/lib/caddy/.local/share/caddy/acme/acme-v02.api.letsencrypt.org-directory").rglob("*.key"))
        if len(accounts) != 1:
            raise SystemExit("Inspect existing production ACME accounts before selecting one")
        api, key = connect(accounts[0])
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                    serialization.NoEncryption())
        (state_directory / "private.key").write_bytes(pem)
        csr = (x509.CertificateSigningRequestBuilder().subject_name(
            x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, args.hostname)]))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(args.hostname)]), critical=False)
            .sign(private, hashes.SHA256()).public_bytes(serialization.Encoding.PEM))
        (state_directory / "request.csr").write_bytes(csr)
        order = api.new_order(csr)
        state = {"hostname": args.hostname, "account_key": str(accounts[0]), "uri": order.uri,
                 "order": order.body.to_json(), "authorizations": [a.to_json() for a in order.authorizations]}
        state_file.write_text(json.dumps(state))
        for authorization in order.authorizations:
            challenge = next(c for c in authorization.body.challenges if isinstance(c.chall, challenges.DNS01))
            print("DNS_RECORD_NAME=" + challenge.validation_domain_name(args.hostname))
            print("DNS_RECORD_VALUE=" + challenge.validation(key))
        print("Publish the TXT record and verify authoritative DNS before finalizing.")
    else:
        state = json.loads(state_file.read_text())
        if state["hostname"] != args.hostname:
            raise SystemExit("Certificate hostname mismatch")
        if (state_directory / "fullchain.pem").exists():
            raise SystemExit("Certificate already saved; inspect before replacing it")
        api, key = connect(state["account_key"])
        authorizations = [messages.AuthorizationResource.from_json(a) for a in state["authorizations"]]
        order = messages.OrderResource(body=messages.Order.from_json(state["order"]), uri=state["uri"],
                                       csr_pem=(state_directory / "request.csr").read_bytes(), authorizations=authorizations)
        for authorization in authorizations:
            challenge = next(c for c in authorization.body.challenges if isinstance(c.chall, challenges.DNS01))
            api.answer_challenge(challenge, challenge.response(key))
        deadline = datetime.datetime.now() + datetime.timedelta(seconds=55)
        issued = api.poll_and_finalize(order, deadline=deadline)
        certificate = x509.load_pem_x509_certificate(issued.fullchain_pem.encode())
        names = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        if args.hostname not in names.get_values_for_type(x509.DNSName):
            raise SystemExit("Issued certificate SAN mismatch")
        (state_directory / "fullchain.pem").write_text(issued.fullchain_pem)
        print("Certificate saved for " + args.hostname)
        print("Expires=" + certificate.not_valid_after_utc.isoformat())


if __name__ == "__main__":
    main()
