using Xunit;

namespace GateProbe
{
    public sealed class AddOneTests
    {
        [Fact]
        public void Increments() => Assert.Equal(2, new AddOne().Add(1));
    }
}
