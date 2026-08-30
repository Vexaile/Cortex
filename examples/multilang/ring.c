/* Plain C: a ring buffer of the kind that lives in an ISR. */
#include <stdio.h>
#include <stdint.h>

#define CAP 8

typedef struct {
    uint8_t data[CAP];
    uint8_t head;
    uint8_t tail;
} Ring;

static int ring_push(Ring *r, uint8_t v) {
    uint8_t next = (uint8_t)((r->head + 1u) % CAP);
    if (next == r->tail) return 0;   /* full */
    r->data[r->head] = v;
    r->head = next;
    return 1;
}

int main(void) {
    Ring r = {0};
    for (uint8_t i = 0; i < 10; i++) {
        printf("push %u -> %d\n", i, ring_push(&r, i));
    }
    return 0;
}
