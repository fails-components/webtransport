// fake include file to fix problem in upstream
#warning fake quic_poll_event_loop.h included

#include "quiche/quic/bindings/quic_libevent.h"
namespace quic
{
    typedef QuicLibeventEventLoopFactory QuicPollEventLoopFactory;
}
