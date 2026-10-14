#!/usr/bin/env python3
"""Carry cloudflared's encrypted HTTP/2 connections over a local HTTP proxy.

The four loopback listeners have fixed Cloudflare destinations. TLS remains
end-to-end between cloudflared and Cloudflare; this process only copies bytes.
"""

import argparse
import asyncio
import logging
import signal


EDGE_LISTENERS = (
    (17844, "region1.v2.argotunnel.com:7844"),
    (17845, "region2.v2.argotunnel.com:7844"),
    (17846, "region1.v2.argotunnel.com:7844"),
    (17847, "region2.v2.argotunnel.com:7844"),
)


async def copy_stream(reader, writer):
    while data := await reader.read(64 * 1024):
        writer.write(data)
        await writer.drain()


async def relay(client_reader, client_writer, destination, proxy_host, proxy_port):
    upstream_writer = None
    transfers = []
    try:
        async with asyncio.timeout(15):
            upstream_reader, upstream_writer = await asyncio.open_connection(
                proxy_host, proxy_port
            )
            upstream_writer.write(
                f"CONNECT {destination} HTTP/1.1\r\n"
                f"Host: {destination}\r\n\r\n".encode("ascii")
            )
            await upstream_writer.drain()
            headers = await upstream_reader.readuntil(b"\r\n\r\n")
            status = headers.split(b"\r\n", 1)[0].split()
            if len(status) < 2 or status[1] != b"200":
                raise ConnectionError("The local proxy rejected CONNECT")
        transfers = [
            asyncio.create_task(copy_stream(client_reader, upstream_writer)),
            asyncio.create_task(copy_stream(upstream_reader, client_writer)),
        ]
        done, _ = await asyncio.wait(transfers, return_when=asyncio.FIRST_COMPLETED)
        for transfer in done:
            transfer.result()
    except (OSError, TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError) as error:
        logging.warning("Relay to %s failed: %s", destination, error)
    finally:
        for transfer in transfers:
            transfer.cancel()
        await asyncio.gather(*transfers, return_exceptions=True)
        for writer in (client_writer, upstream_writer):
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except OSError:
                    pass


async def serve(proxy_host, proxy_port):
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopped.set)
    servers = []
    try:
        for port, destination in EDGE_LISTENERS:
            async def accept(reader, writer, destination=destination):
                await relay(reader, writer, destination, proxy_host, proxy_port)

            servers.append(await asyncio.start_server(accept, "127.0.0.1", port))
            logging.info("127.0.0.1:%s -> %s through local proxy", port, destination)
        await stopped.wait()
    finally:
        for server in servers:
            server.close()
        await asyncio.gather(*(server.wait_closed() for server in servers))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proxy-host", default="127.0.0.1")
    parser.add_argument("--proxy-port", type=int, default=7897)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(serve(args.proxy_host, args.proxy_port))
