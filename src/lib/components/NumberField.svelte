<script lang="ts">
  interface Props {
    value: number;
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    /** Shown after the input, e.g. a unit or a derived value. */
    suffix?: string;
    width?: string;
  }

  let {
    value = $bindable(),
    label,
    min,
    max,
    step = 'any' as unknown as number,
    suffix,
    width = '7rem',
  }: Props = $props();
</script>

<label class="field">
  {#if label}<span class="label">{label}</span>{/if}
  <span class="control">
    <input type="number" bind:value {min} {max} {step} style:width />
    {#if suffix}<span class="suffix">{suffix}</span>{/if}
  </span>
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .label {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  input {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .suffix {
    color: var(--text-dim);
    font-size: 0.8rem;
    white-space: nowrap;
  }
</style>
